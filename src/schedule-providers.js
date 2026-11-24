import { airportTimeZone, hasTimeFilter, KOREA_TIME_ZONE, localTimeWindow, wallAt } from './lookup-time.js';

const DAY_MS = 86_400_000;
const MONTH_MS = 31 * DAY_MS;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const KAC_AIRPORTS = new Set([
  'GMP', 'PUS', 'CJU', 'TAE', 'USN', 'CJJ', 'MWX', 'KWJ', 'RSU', 'KPO', 'YNY', 'HIN', 'KUV', 'WJU',
]);

export function normalizePortalServiceKey(value) {
  const key = value.trim();
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

function endpoint(address, parameters, metadata) {
  const url = new URL(address);
  for (const [name, value] of Object.entries(parameters)) {
    if (value === undefined) continue;
    const parameter = name === 'serviceKey' ? normalizePortalServiceKey(String(value)) : String(value);
    url.searchParams.set(name, parameter);
  }
  return { url, ...metadata };
}

function flightFields({ ident, identType, operation }) {
  if (!ident) {
    if (operation === 'flight') throw new Error('Supply a flight number.');
    return {};
  }
  const iata = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
  const icao = /^[A-Z]{3}\d{1,4}[A-Z]?$/;
  const type = !identType || identType === 'flight_number' ? (icao.test(ident) ? 'icao' : 'iata') : identType;
  if (type === 'iata' && iata.test(ident)) return { flight_iata: ident };
  if (type === 'icao' && icao.test(ident)) return { flight_icao: ident };
  throw new Error('Supply an IATA or ICAO flight number for this provider.');
}

function iataFlight(input) {
  const fields = flightFields(input);
  if (fields.flight_icao) throw new Error('Supply the IATA flight number for this provider.');
  return fields.flight_iata;
}

function requireDirection(input) {
  if (input.direction !== 'arrival' && input.direction !== 'departure') {
    throw new Error('Set direction to arrival or departure for this provider.');
  }
  return input.direction;
}

function airportFields(input) {
  if (!input.airport) {
    if (input.operation === 'airport' || input.oppositeAirport) throw new Error('Supply the primary airport.');
    return {};
  }
  const arrival = requireDirection(input) === 'arrival';
  const primary = arrival ? 'arr' : 'dep';
  const opposite = arrival ? 'dep' : 'arr';
  const primaryCodeType = input.airport.length === 3 ? 'iata' : 'icao';
  const filters = { [`${primary}_${primaryCodeType}`]: input.airport };
  if (input.oppositeAirport) {
    const oppositeCodeType = input.oppositeAirport.length === 3 ? 'iata' : 'icao';
    filters[`${opposite}_${oppositeCodeType}`] = input.oppositeAirport;
  }
  return filters;
}

function checkCommercialLiveFilters(input, provider) {
  if (hasTimeFilter(input)) {
    throw new Error(`${provider} does not support a requested time window on this live endpoint.`);
  }
  if (input.market || input.cursor) {
    throw new Error(`${provider} does not accept market or cursor filters. Use supported airport filters or numeric pages.`);
  }
  if (input.direction && !input.airport) {
    throw new Error(`Supply the airport for an arrival or departure filter on ${provider}.`);
  }
}

function pageLimit(input, maximum = 100) {
  return Math.min(input.limit ?? 10, maximum);
}

function offsetPage(input, maximum) {
  const limit = pageLimit(input, maximum);
  const offset = ((input.page ?? 1) - 1) * limit;
  return { limit, offset: offset || undefined };
}

function commonPortalParameters(input, serviceKey) {
  if (input.cursor) throw new Error('This public data endpoint accepts page and limit instead of a cursor.');
  return {
    serviceKey,
    pageNo: input.page ?? 1,
    numOfRows: pageLimit(input),
    type: input.format ?? 'json',
  };
}

function kstDate() {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function koreaTimeFilters(input) {
  const explicitRange = input.start || input.end;
  if (!hasTimeFilter(input) || (!explicitRange && (!input.timeZone || input.timeZone === KOREA_TIME_ZONE))) return input;
  if (explicitRange && !(input.start && input.end)) {
    throw new Error('Supply both start and end for a Korean airport time window.');
  }
  if (explicitRange && [input.start, input.end].some((value) => Date.parse(value) % 60_000 !== 0)) {
    throw new Error('Korean airport feeds accept start and end at whole-minute precision.');
  }
  const { from, to } = localTimeWindow(input, KOREA_TIME_ZONE);
  const date = from.slice(0, 10);
  const midnightNextDay = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 19);
  const toTime = to === midnightNextDay ? '2400' : to.slice(11, 16).replace(':', '');
  if (to.slice(0, 10) !== date && toTime !== '2400') {
    throw new Error('This Korean airport feed accepts only one Korea-local day per request.');
  }
  return { ...input, date, fromTime: from.slice(11, 16).replace(':', ''), toTime };
}

function portalFlightIdentifier(input, native = true) {
  if (native && input.identType === 'provider_id') {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.ident ?? '')) throw new Error('Supply the flight record ID exactly as returned by this source.');
    return { recordId: input.ident };
  }
  return { flightId: iataFlight(input) };
}

function incheonFilters(input, native) {
  if (input.airport && !['ICN', 'RKSI'].includes(input.airport)) {
    throw new Error('Set airport to ICN or RKSI for Incheon airport operations.');
  }
  const action = requireDirection(input) === 'arrival' ? 'Arrivals' : 'Departures';
  const { flightId, recordId } = portalFlightIdentifier(input, native);
  const exact = flightId || recordId;
  const oppositeAirport = exact ? undefined : input.oppositeAirport;
  if (oppositeAirport && !/^[A-Z]{3}$/.test(oppositeAirport)) {
    throw new Error('Use a three-letter IATA code for the opposite airport.');
  }
  const routeFilterNote = exact && input.oppositeAirport
    ? 'Incheon searched the exact flight or record ID for ICN arrival or departure. The opposite airport was omitted as a filter.'
    : undefined;
  return { action, flightId, recordId, oppositeAirport, routeFilterNote };
}

function koreanFlightDate(input, provider) {
  const today = kstDate();
  const date = input.date ?? today;
  const daysFromToday = (Date.parse(date) - Date.parse(today)) / DAY_MS;
  if (daysFromToday < -3 || daysFromToday > 6) {
    throw new Error(`${provider} accepts dates from three days ago through six days ahead in Korea time.`);
  }
  return date.replaceAll('-', '');
}

function datedMovement(input, recordId) {
  const time = koreaTimeFilters(input);
  if (input.operation === 'history' && ((!time.date && !recordId) || (time.date && time.date > kstDate()))) {
    throw new Error('Supply a current or past Korean date or the exact flight record ID for historical movements.');
  }
  return time;
}

function incheonDetailed(kind, key) {
  return (input, env) => {
    const { action, flightId, recordId, oppositeAirport, routeFilterNote } = incheonFilters(input);
    const time = datedMovement(input, recordId);
    return endpoint(`https://apis.data.go.kr/B551177/StatusOf${kind}FlightsDeOdp/get${kind}${action}DeOdp`, {
      ...commonPortalParameters(input, env[key]),
      searchday: !recordId || time.date ? koreanFlightDate(time, 'Incheon airport') : undefined,
      from_time: time.fromTime,
      to_time: time.toTime,
      airport_code: oppositeAirport,
      f_id: recordId,
      flight_id: flightId,
      inqtimechcd: kind === 'Passenger' ? 'E' : undefined,
    }, { routeFilterNote });
  };
}

const incheonCargo = incheonDetailed('Cargo', 'INCHEON_CARGO_SERVICE_KEY');
const incheonPassengerDetail = incheonDetailed('Passenger', 'INCHEON_PASSENGER_SERVICE_KEY');

function incheonFlights(input, env, aircraftRole) {
  const { action, flightId, recordId, oppositeAirport, routeFilterNote } = incheonFilters(input);
  const time = datedMovement(input, recordId);
  return endpoint(`https://apis.data.go.kr/B551177/statusOfAllFltDeOdp/getFlt${action}DeOdp`, {
    ...commonPortalParameters(input, env.INCHEON_ALL_FLIGHTS_SERVICE_KEY),
    searchDate: time.date ? koreanFlightDate(time, 'Incheon airport') : undefined,
    searchFrom: time.fromTime,
    searchTo: time.toTime,
    passengerOrCargo: aircraftRole,
    airportCode: oppositeAirport,
    fid: recordId,
    flightId,
  }, { routeFilterNote });
}

const incheonAllCargo = (input, env) => incheonFlights(input, env, 'C');

function incheonCargoToday(input, env) {
  const { action, flightId, oppositeAirport, routeFilterNote } = incheonFilters(input, false);
  const time = koreaTimeFilters(input);
  if (time.date && time.date !== kstDate()) {
    throw new Error('Incheon same-day cargo accepts today in Korea time. Use detailed cargo for other supported dates.');
  }
  if (input.cursor || (input.page ?? 1) !== 1) throw new Error('Incheon same-day cargo has no pagination. Filter by flight, route, or time.');
  return endpoint(`https://apis.data.go.kr/B551177/StatusOfCargoFlights/getCargo${action}`, {
    serviceKey: env.INCHEON_CARGO_TODAY_SERVICE_KEY,
    from_time: time.fromTime,
    to_time: time.toTime,
    airport: oppositeAirport,
    flight_id: flightId,
    type: input.format ?? 'json',
  }, { routeFilterNote });
}

function incheonPassengerTimetable(input, env) {
  if (input.airport && !['ICN', 'RKSI'].includes(input.airport)) throw new Error('Set airport to ICN or RKSI for the Incheon passenger timetable.');
  if (!/^[A-Z]{3}$/.test(input.oppositeAirport ?? '')) throw new Error('Supply the opposite airport as a three-letter IATA code for the Incheon timetable.');
  if (input.ident || input.identType || input.market || hasTimeFilter(input)) {
    throw new Error('The Incheon recurring timetable filters by route and direction. Dates, weekdays and flight numbers are provided in the response.');
  }
  const action = requireDirection(input) === 'arrival' ? 'Arrivals' : 'Departures';
  return endpoint(`https://apis.data.go.kr/B551177/PaxFltSched/getPaxFltSched${action}`, {
    ...commonPortalParameters(input, env.INCHEON_PASSENGER_TIMETABLE_SERVICE_KEY),
    airport: input.oppositeAirport,
  }, { timeFilterNote: 'Published seasonal timetable with validity dates and operating weekdays.' });
}

function kacSchedule(input, env) {
  const time = koreaTimeFilters(input);
  if ((time.fromTime && time.fromTime !== '0000') || (time.toTime && time.toTime !== '2400')) {
    throw new Error('KAC schedules only support whole-day date filters.');
  }
  const ident = iataFlight(input);
  if ((input.airport || input.oppositeAirport || input.operation === 'airport' || !ident) && !KAC_AIRPORTS.has(input.airport)) {
    throw new Error('Set airport to the three-letter IATA code of a KAC airport, such as GMP, PUS, or CJU.');
  }
  if (input.oppositeAirport && !/^[A-Z]{3}$/.test(input.oppositeAirport)) {
    throw new Error('Use a three-letter IATA code for the opposite airport.');
  }
  const arrival = input.airport && requireDirection(input) === 'arrival';
  const domestic = input.market ? input.market === 'domestic' :
    KAC_AIRPORTS.has(input.oppositeAirport) || input.oppositeAirport === 'ICN';
  if (!input.market && !input.oppositeAirport) {
    throw new Error('Set market to domestic or international, or provide the opposite airport for KAC schedules.');
  }
  return endpoint(`https://apis.data.go.kr/B551178/flight-schedule/${domestic ? 'dom' : 'int'}`, {
    ...commonPortalParameters(input, env.KAC_SCHEDULE_SERVICE_KEY),
    schDate: (time.date ?? kstDate()).replaceAll('-', ''),
    schDeptCityCode: arrival ? input.oppositeAirport : input.airport,
    schArrvCityCode: arrival ? input.airport : input.oppositeAirport,
    schAirLine: domestic ? ident?.slice(0, 2) : undefined,
    schFlightNum: domestic ? ident?.slice(2) : ident,
  });
}

function kacRealtimeParameters(input, serviceKey) {
  if (input.oppositeAirport || input.cursor || (input.page ?? 1) !== 1) {
    throw new Error('This KAC real-time query does not accept route or pagination filters.');
  }
  if (input.airport && !KAC_AIRPORTS.has(input.airport)) {
    throw new Error('Use a KAC airport IATA code such as GMP, PUS or CJU, or omit the airport filter.');
  }
  const time = koreaTimeFilters(input);
  if (time.date && time.date !== kstDate()) {
    throw new Error('KAC real-time operations accept clock bounds for current operations only.');
  }
  return {
    serviceKey,
    schLineType: { domestic: 'D', international: 'I' }[input.market],
    schIOType: { arrival: 'I', departure: 'O' }[input.direction],
    schAirCode: input.airport,
    schStTime: time.fromTime,
    schEdTime: time.toTime === '2400' ? '2359' : time.toTime,
    type: input.format ?? 'json',
  };
}

function kacFlight(input, env) {
  return endpoint('https://apis.data.go.kr/B551178/flight-search/info', {
    ...kacRealtimeParameters(input, env.KAC_FLIGHT_SEARCH_SERVICE_KEY),
    schFln: iataFlight(input),
  });
}

function kacStatus(input, env) {
  if (input.ident) throw new Error('Use KAC flight search for an exact flight-number filter.');
  return endpoint('https://apis.data.go.kr/B551178/flight-status/info',
    kacRealtimeParameters(input, env.KAC_FLIGHT_STATUS_SERVICE_KEY));
}

function kacStatusDetail(input, env) {
  if (input.ident || input.airport || input.oppositeAirport || input.direction || input.market ||
      input.date || input.start || input.end || input.fromTime || input.toTime) {
    throw new Error('KAC status detail accepts page, limit and format. Use the status list for airport, direction or time filters.');
  }
  return endpoint('https://apis.data.go.kr/B551178/flight-status/detail',
    commonPortalParameters(input, env.KAC_FLIGHT_STATUS_SERVICE_KEY));
}

function validateKacAirport(airport) {
  if (airport && !KAC_AIRPORTS.has(airport)) {
    throw new Error('Use a KAC airport IATA code such as GMP, PUS or CJU.');
  }
}

function kacRouteFields(input) {
  validateKacAirport(input.airport);
  if (input.oppositeAirport && (!input.airport || !/^[A-Z]{3}$/.test(input.oppositeAirport))) {
    throw new Error('Supply a KAC airport and a three-letter IATA code for the opposite airport.');
  }
  if (!input.airport) return {};
  return requireDirection(input) === 'arrival'
    ? { depCityCode: input.oppositeAirport, arrvCityCode: input.airport }
    : { depCityCode: input.airport, arrvCityCode: input.oppositeAirport };
}

const marketLine = { domestic: 'D', international: 'I' };

function kacDatedStatus(input, env) {
  const direction = requireDirection(input);
  const { depCityCode, arrvCityCode } = kacRouteFields(input);
  const { flightId, recordId } = portalFlightIdentifier(input);
  if (!input.airport && !flightId && !recordId) throw new Error('Supply a KAC airport, flight number or flight record ID.');
  const time = datedMovement(input, recordId);
  const opposite = direction === 'arrival' ? { dep_airport_code: depCityCode } : { arr_airport_code: arrvCityCode };
  return endpoint(`https://apis.data.go.kr/B551178/flight-status/${direction === 'arrival' ? 'arrival' : 'depart'}`, {
    ...commonPortalParameters(input, env.KAC_FLIGHT_STATUS_SERVICE_KEY),
    searchday: !recordId || time.date ? koreanFlightDate(time, 'KAC dated status') : undefined,
    from_time: time.fromTime,
    to_time: time.toTime === '2400' ? '2359' : time.toTime,
    airport_code: input.airport,
    f_id: recordId,
    flight_id: flightId,
    line: marketLine[input.market],
    ...opposite,
  }, { timeFilterBasis: time.fromTime || time.toTime ? 'scheduled_time' : undefined });
}

function kacTaxfreeStatus(input, env) {
  const route = kacRouteFields(input);
  const { flightId, recordId } = portalFlightIdentifier(input);
  if (!input.airport && !flightId && !recordId) throw new Error('Supply a KAC airport, flight number or flight record ID.');
  if (input.market || (input.direction && !input.airport)) throw new Error('This KAC status endpoint uses airport route codes and has no separate market or direction filter.');
  const time = koreaTimeFilters(input);
  return endpoint('https://apis.data.go.kr/B551178/flight-status/taxfree', {
    ...commonPortalParameters(input, env.KAC_FLIGHT_STATUS_SERVICE_KEY),
    searchDate: !recordId || time.date ? (time.date ?? kstDate()).replaceAll('-', '') : undefined,
    searchFrom: time.fromTime,
    searchTo: time.toTime === '2400' ? '2359' : time.toTime,
    fid: recordId,
    flightId,
    ...route,
  });
}

function kacTaxfreeSchedule(input, env) {
  const route = kacRouteFields(input);
  const { flightId, recordId } = portalFlightIdentifier(input);
  if (!input.airport && !flightId && !recordId) throw new Error('Supply a KAC airport, flight number or flight record ID.');
  if (hasTimeFilter(input)) throw new Error('This KAC timetable has no date or time filter. Use kac_schedule for a specific date.');
  if (!input.market && !input.oppositeAirport) throw new Error('Set market to domestic or international, or provide the opposite airport.');
  if (input.direction && !input.airport) throw new Error('Supply the airport for a departure or arrival timetable filter.');
  const domestic = input.market ? input.market === 'domestic' : KAC_AIRPORTS.has(input.oppositeAirport) || input.oppositeAirport === 'ICN';
  return endpoint(`https://apis.data.go.kr/B551178/flight-schedule/taxfree-${domestic ? 'dom' : 'int'}`, {
    ...commonPortalParameters(input, env.KAC_SCHEDULE_SERVICE_KEY),
    fid: recordId,
    flightId,
    ...route,
  });
}

function kacAircraftStatus(input, env) {
  validateKacAirport(input.airport);
  if (input.direction || hasTimeFilter(input)) {
    throw new Error('This KAC aircraft feed shows current operations with no direction or generic movement window filter.');
  }
  const registration = input.identType === 'registration' ? input.ident : undefined;
  if (input.identType === 'registration' && !/^[A-Z0-9-]{1,12}$/.test(registration ?? '')) {
    throw new Error('Supply the aircraft registration.');
  }
  const flightId = registration ? undefined : iataFlight(input);
  if (!input.airport && !flightId && !registration) throw new Error('Supply a KAC airport, IATA flight number or aircraft registration.');
  return endpoint('https://apis.data.go.kr/B551178/flight-aircraft-status/info', {
    ...commonPortalParameters(input, env.KAC_AIRCRAFT_STATUS_SERVICE_KEY),
    schAirCode: input.airport,
    schFln: flightId,
    Line: marketLine[input.market],
    schAPLno: registration,
  });
}

function flightAirportContext(input) {
  if (input.operation === 'flight' && input.ident && input.airport && !input.direction && !input.oppositeAirport) {
    return { routeFilterNote: 'The airport has no arrival or departure role in this request. Compare it with the returned origin and destination.' };
  }
}

function airLabsFlight(input, env) {
  if (!input.ident) throw new Error('Supply a flight number.');
  const context = flightAirportContext(input);
  if (input.airport && !context) return airLabsSchedule(input, env);
  checkCommercialLiveFilters(input, 'AirLabs');
  if ((input.page ?? 1) !== 1) throw new Error('AirLabs Flight Info returns one result and has no numeric pages.');
  return endpoint('https://airlabs.co/api/v9/flight', {
    api_key: env.AIRLABS_API_KEY,
    ...flightFields(input),
  }, context);
}

function airLabsSchedule(input, env) {
  checkCommercialLiveFilters(input, 'AirLabs');
  if (!input.ident && !input.airport) throw new Error('Supply a flight number or airport for AirLabs schedules.');
  return endpoint('https://airlabs.co/api/v9/schedules', {
    api_key: env.AIRLABS_API_KEY,
    ...flightFields(input),
    ...airportFields(input),
    ...offsetPage(input, 50),
  }, input.operation === 'flight' ? {
    timeFilterNote: 'AirLabs used its live schedule (up to ten hours ahead) to apply airport filters.',
  } : undefined);
}

function airLabsAircraftFilter(input) {
  if (input.identType === 'icao24' && /^[A-F0-9]{6}$/.test(input.ident)) return { hex: input.ident };
  if (input.identType === 'registration' && /^[A-Z0-9-]{1,12}$/.test(input.ident)) return { reg_number: input.ident };
  throw new Error('Use an ICAO24 address or registration for AirLabs aircraft lookups.');
}

function airLabsLive(input, env) {
  checkCommercialLiveFilters(input, 'AirLabs');
  if (!input.ident || input.limit != null || (input.page ?? 1) !== 1) {
    throw new Error('AirLabs live positions use one known identifier and have no page or result limit.');
  }
  const filters = ['icao24', 'registration'].includes(input.identType) ? airLabsAircraftFilter(input) : flightFields(input);
  return endpoint('https://airlabs.co/api/v9/flights', {
    api_key: env.AIRLABS_API_KEY,
    ...filters,
    ...airportFields(input),
  });
}

function airLabsHistory(input, env) {
  if (hasTimeFilter(input) || input.airport || input.oppositeAirport || input.direction || input.market || input.limit != null || (input.page ?? 1) !== 1) {
    throw new Error('AirLabs historical beta filters by exact flight number and optional numeric offset. It does not accept a date or route.');
  }
  if (!input.ident || (input.cursor && !/^\d{1,9}$/.test(input.cursor))) {
    throw new Error('Supply an exact flight number and a numeric cursor if paging an AirLabs history query.');
  }
  return endpoint('https://airlabs.co/api/v10/historical', {
    api_key: env.AIRLABS_API_KEY,
    ...flightFields(input),
    offset: input.cursor,
  });
}

function airLabsAirline(input, env) {
  const code = input.identType === 'iata' && /^[A-Z0-9]{2}$/.test(input.ident) ? 'iata_code'
    : input.identType === 'icao' && /^[A-Z]{3}$/.test(input.ident) ? 'icao_code' : null;
  if (!code) throw new Error('Supply an IATA or ICAO airline code for AirLabs.');
  return endpoint('https://airlabs.co/api/v9/airlines', { api_key: env.AIRLABS_API_KEY, [code]: input.ident });
}

function aviationstackFlights(input, env) {
  if (input.operation === 'history' && !input.date) {
    throw new Error('Supply one date for Aviationstack historical flights.');
  }
  if (input.start || input.end || input.fromTime || input.toTime) {
    throw new Error('Aviationstack flights can filter by one calendar date, without clock bounds.');
  }
  if (input.date && input.date > wallAt(Date.now(), airportTimeZone(input) ?? 'UTC').slice(0, 10)) {
    throw new Error('Use a schedule lookup for a future Aviationstack date.');
  }
  checkCommercialLiveFilters({ ...input, date: undefined }, 'Aviationstack');
  if (!input.ident && !input.airport) throw new Error('Supply a flight number or airport for Aviationstack.');
  const context = flightAirportContext(input);
  if (!context && [input.airport, input.oppositeAirport].some((airport) => airport && !/^[A-Z]{3}$/.test(airport))) {
    throw new Error('Use three-letter IATA airport codes for Aviationstack.');
  }
  return endpoint('https://api.apilayer.net/aviationstack/v1/flights', {
    access_key: env.AVIATIONSTACK_API_KEY,
    flight_date: input.date,
    ...flightFields(input),
    ...(context ? {} : airportFields(input)),
    ...offsetPage(input, 100),
  }, { ...context, ...(input.date ? { timeFilterBasis: 'flight_date' } : {}) });
}

function aviationstackSchedule(input, env) {
  if (!/^[A-Z]{3}$/.test(input.airport ?? '') || !input.date) {
    throw new Error('Supply one IATA airport code and future date for Aviationstack schedules.');
  }
  if (input.ident || input.oppositeAirport || input.market || input.cursor || input.limit != null || (input.page ?? 1) !== 1 ||
      input.start || input.end || input.fromTime || input.toTime) {
    throw new Error('The Aviationstack future board filters one airport, direction and date. It does not document flight-number, route, clock or pagination filters.');
  }
  const zone = airportTimeZone(input);
  const today = wallAt(Date.now(), zone ?? 'UTC').slice(0, 10);
  if (input.date < today || (zone && input.date === today)) {
    throw new Error('Aviationstack future schedules require a date after today at the airport.');
  }
  return endpoint('https://api.apilayer.net/aviationstack/v1/flightsFuture', {
    access_key: env.AVIATIONSTACK_API_KEY,
    iataCode: input.airport,
    type: requireDirection(input),
    date: input.date,
  }, { timeFilterBasis: 'scheduled_airport_local_date' });
}

export const scheduleProviders = [
  {
    id: 'kac_schedule',
    label: 'Korea Airports Corporation schedules',
    docs: 'https://www.data.go.kr/data/15158949/openapi.do',
    note: 'Schedules for the 14 KAC airports. Supply an IATA flight number plus market, or a KAC IATA airport with direction and market or opposite airport. Date defaults to today in KST. Use an Encoding or Decoding service key. Development quota is 5,000 per day.',
    formats: ['json', 'xml'],
    keys: ['KAC_SCHEDULE_SERVICE_KEY'],
    routeOperations: ['airport', 'schedule'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { airport: kacSchedule, schedule: kacSchedule },
  },
  {
    id: 'kac_flight_status',
    label: 'Korea Airports Corporation live flight-number search',
    docs: 'https://www.data.go.kr/data/15160195/openapi.do',
    note: 'Live status by IATA flight number for the 14 KAC airports. A KAC IATA airport filter is optional. Optional time bounds use Korea-local HHmm for current operations. Use an Encoding or Decoding service key. Development quota is 5,000 per day.',
    formats: ['json', 'xml'],
    keys: ['KAC_FLIGHT_SEARCH_SERVICE_KEY'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { flight: kacFlight },
  },
  {
    id: 'kac_aircraft_status',
    label: 'Korea Airports Corporation aircraft assignments',
    docs: 'https://www.data.go.kr/data/15158519/openapi.do',
    note: 'Current operations with aircraft type and registration. Select this source for aircraft assignments by IATA flight number, registration or KAC airport. This dataset requires its own portal approval.',
    formats: ['json', 'xml'],
    keys: ['KAC_AIRCRAFT_STATUS_SERVICE_KEY'],
    explicitSelection: true,
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { flight: kacAircraftStatus, airport: kacAircraftStatus },
  },
  {
    id: 'kac_realtime_status',
    label: 'Korea Airports Corporation real-time airport operations',
    docs: 'https://www.data.go.kr/data/15158625/openapi.do',
    note: 'Real-time listing. Optional KAC IATA airport, arrival/departure, domestic/international and HHmm time filters. The upstream list has no documented pagination or flight-number filter.',
    formats: ['json', 'xml'],
    keys: ['KAC_FLIGHT_STATUS_SERVICE_KEY'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { airport: kacStatus },
  },
  {
    id: 'kac_realtime_status_detail',
    label: 'Korea Airports Corporation real-time operation detail',
    docs: 'https://www.data.go.kr/data/15158625/openapi.do',
    note: 'Paginated live delay, cancellation and flight details. Select this provider with operation airport and use page, limit and format. The upstream endpoint has no documented airport, time or flight-number filter.',
    formats: ['json', 'xml'],
    keys: ['KAC_FLIGHT_STATUS_SERVICE_KEY'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { airport: kacStatusDetail },
  },
  {
    id: 'kac_dated_status',
    label: 'Korea Airports Corporation dated flight and delay status',
    docs: 'https://www.data.go.kr/data/15158625/openapi.do',
    note: 'Dated passenger movements, delays and cancellations from D−3 through D+6 in Korea time. Select this source for direction, airport, flight number or a native flight record ID. Time-of-day bounds use planned times.',
    formats: ['json', 'xml'],
    keys: ['KAC_FLIGHT_STATUS_SERVICE_KEY'],
    explicitSelection: true,
    routeOperations: ['flight', 'history', 'airport'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { flight: kacDatedStatus, history: kacDatedStatus, airport: kacDatedStatus },
  },
  {
    id: 'kac_taxfree_status',
    label: 'Korea Airports Corporation tax-free passenger movement feed',
    docs: 'https://www.data.go.kr/data/15158625/openapi.do',
    note: 'Additional passenger movement feed with KST date, route, flight number and native record ID filters. Select explicitly for this feed.',
    formats: ['json', 'xml'],
    keys: ['KAC_FLIGHT_STATUS_SERVICE_KEY'],
    explicitSelection: true,
    routeOperations: ['flight', 'airport'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { flight: kacTaxfreeStatus, airport: kacTaxfreeStatus },
  },
  {
    id: 'kac_taxfree_schedule',
    label: 'Korea Airports Corporation tax-free timetables',
    docs: 'https://www.data.go.kr/data/15158949/openapi.do',
    note: 'Select this timetable by domestic or international market and flight or KAC route. The native schedules have no operating-date filter.',
    formats: ['json', 'xml'],
    keys: ['KAC_SCHEDULE_SERVICE_KEY'],
    explicitSelection: true,
    routeOperations: ['schedule'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { schedule: kacTaxfreeSchedule },
  },
  {
    id: 'incheon_cargo_today',
    label: 'Incheon Airport same-day cargo status',
    docs: 'https://www.data.go.kr/data/15095068/openapi.do',
    note: 'ICN arrivals or departures for today in KST. Set direction and use an IATA flight number, opposite airport or time window to narrow unpaginated results. Use an Encoding or Decoding service key. Development quota is 1,000 per day.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_CARGO_TODAY_SERVICE_KEY'],
    routeOperations: ['flight', 'airport', 'schedule'],
    limits: [{ requests: 1_000, windowMs: DAY_MS }],
    operations: { flight: incheonCargoToday, airport: incheonCargoToday, schedule: incheonCargoToday },
  },
  {
    id: 'incheon_cargo',
    label: 'Incheon Airport cargo flight status',
    docs: 'https://www.data.go.kr/data/15113461/openapi.do',
    note: 'ICN cargo arrivals or departures, KST D−3 to D+6 as available. Set direction. Date defaults to today in KST. Changed time is the airport’s reported schedule adjustment. Use an Encoding or Decoding service key. Development quota is 500 per day.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_CARGO_SERVICE_KEY'],
    routeOperations: ['flight', 'history', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonCargo, history: incheonCargo, airport: incheonCargo, schedule: incheonCargo },
  },
  {
    id: 'incheon_passenger',
    label: 'Incheon Airport detailed flight status',
    docs: 'https://www.data.go.kr/data/15140153/openapi.do',
    note: 'ICN passenger arrivals or departures from the detailed aircraft operations API, KST D−3 to D+6 as available. Set direction. Date defaults to today in KST. Use an Encoding or Decoding service key. Development quota is 500 per day.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_ALL_FLIGHTS_SERVICE_KEY'],
    routeOperations: ['flight', 'history', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonFlights, history: incheonFlights, airport: incheonFlights, schedule: incheonFlights },
  },
  {
    id: 'incheon_all_cargo',
    label: 'Incheon Airport detailed aircraft operations (cargo mode)',
    docs: 'https://www.data.go.kr/data/15140153/openapi.do',
    note: 'Explicit cargo mode of the all-flight dataset with registration, equipment type and stand. Uses the same service key and date coverage as incheon_passenger.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_ALL_FLIGHTS_SERVICE_KEY'],
    explicitSelection: true,
    routeOperations: ['flight', 'history', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonAllCargo, history: incheonAllCargo, airport: incheonAllCargo, schedule: incheonAllCargo },
  },
  {
    id: 'incheon_passenger_detail',
    label: 'Incheon Airport dedicated passenger flight status',
    docs: 'https://www.data.go.kr/data/15112968/openapi.do',
    note: 'ICN passenger arrivals or departures, KST D−3 to D+6 as available. Set direction. Date defaults to today in KST. Use an Encoding or Decoding service key. Development quota is 500 per day.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_PASSENGER_SERVICE_KEY'],
    routeOperations: ['flight', 'history', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonPassengerDetail, history: incheonPassengerDetail, airport: incheonPassengerDetail, schedule: incheonPassengerDetail },
  },
  {
    id: 'incheon_passenger_timetable',
    label: 'Incheon Airport published recurring passenger timetable',
    docs: 'https://www.data.go.kr/data/15095059/openapi.do',
    note: 'Select for the published seasonal ICN passenger timetable by direction and opposite IATA airport. Returns validity dates and operating weekdays. This dataset requires its own portal approval.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_PASSENGER_TIMETABLE_SERVICE_KEY'],
    explicitSelection: true,
    routeOperations: ['schedule'],
    limits: [{ requests: 1_000, windowMs: DAY_MS }],
    operations: { schedule: incheonPassengerTimetable },
  },
  {
    id: 'airlabs',
    label: 'AirLabs',
    docs: 'https://airlabs.co/docs/schedules',
    note: 'Live flight, position and airport schedule lookups, plus exact aircraft, airport and airline reference queries. Historical flight-number lookup uses the v10 beta and has no date filter.',
    keys: ['AIRLABS_API_KEY'],
    airportInfoOnly: true,
    airportInfo(input, env) {
      const code = input.airport.length === 3 ? 'iata_code' : 'icao_code';
      return endpoint('https://airlabs.co/api/v9/airports', { api_key: env.AIRLABS_API_KEY, [code]: input.airport });
    },
    routeOperations: ['flight', 'live', 'airport', 'schedule'],
    limits: [{ requests: 1_000, windowMs: MONTH_MS }],
    operations: {
      flight: airLabsFlight, live: airLabsLive, history: airLabsHistory, airport: airLabsSchedule, schedule: airLabsSchedule,
      aircraft(input, env) {
        return endpoint('https://airlabs.co/api/v9/fleets', { api_key: env.AIRLABS_API_KEY, ...airLabsAircraftFilter(input), limit: 1 });
      },
      airline_info: airLabsAirline,
    },
  },
  {
    id: 'aviationstack',
    label: 'Aviationstack',
    docs: 'https://docs.apilayer.com/aviationstack/docs/api-documentation',
    note: 'Real-time flights on the 100-requests-per-month free personal plan. Date-based history and future airport boards require Basic or higher. Future boards use one IATA airport, direction and date.',
    keys: ['AVIATIONSTACK_API_KEY'],
    routeOperations: ['flight', 'airport', 'history'],
    limits: [{ requests: 100, windowMs: MONTH_MS }],
    operations: { flight: aviationstackFlights, airport: aviationstackFlights, history: aviationstackFlights, schedule: aviationstackSchedule },
  },
];

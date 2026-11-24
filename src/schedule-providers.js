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

function endpoint(address, parameters) {
  const url = new URL(address);
  for (const [name, value] of Object.entries(parameters)) {
    if (value === undefined) continue;
    const parameter = name === 'serviceKey' ? normalizePortalServiceKey(String(value)) : String(value);
    url.searchParams.set(name, parameter);
  }
  return { url };
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

function checkLiveWindow(input, provider, canFilterAirport = true) {
  if (input.date || input.start || input.end || input.fromTime || input.toTime) {
    throw new Error(`${provider} supports a live lookup here. Omit the date and time filters.`);
  }
  if (!canFilterAirport && (input.airport || input.oppositeAirport)) {
    throw new Error(`${provider} cannot apply airport filters to its single-flight lookup.`);
  }
}

function pageLimit(input, maximum = 100) {
  return Math.min(input.limit ?? 10, maximum);
}

function offsetPage(input, maximum) {
  const limit = pageLimit(input, maximum);
  return { limit, offset: ((input.page ?? 1) - 1) * limit };
}

function commonPortalParameters(input, serviceKey) {
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

function incheonDirection(input) {
  if (input.start || input.end) {
    throw new Error('Use a Korea-local date and HHmm time bounds for Incheon airport operations.');
  }
  if (input.airport && !['ICN', 'RKSI'].includes(input.airport)) {
    throw new Error('Set airport to ICN or RKSI for Incheon airport operations.');
  }
  if (input.oppositeAirport && !/^[A-Z]{3}$/.test(input.oppositeAirport)) {
    throw new Error('Use a three-letter IATA code for the opposite airport.');
  }
  return requireDirection(input) === 'arrival' ? 'Arrivals' : 'Departures';
}

function incheonSearchDate(input) {
  const today = kstDate();
  const date = input.date ?? today;
  const daysFromToday = (Date.parse(date) - Date.parse(today)) / DAY_MS;
  if (daysFromToday < -3 || daysFromToday > 6) {
    throw new Error('Incheon airport accepts dates from three days ago through six days ahead in Korea time.');
  }
  return date.replaceAll('-', '');
}

function incheonDetailed(kind, key) {
  return (input, env) => {
    const action = incheonDirection(input);
    return endpoint(`https://apis.data.go.kr/B551177/StatusOf${kind}FlightsDeOdp/get${kind}${action}DeOdp`, {
      ...commonPortalParameters(input, env[key]),
      searchday: incheonSearchDate(input),
      from_time: input.fromTime ?? '0000',
      to_time: input.toTime ?? '2400',
      airport_code: input.oppositeAirport,
      flight_id: iataFlight(input),
      inqtimechcd: 'E',
      lang: 'K',
    });
  };
}

const incheonCargo = incheonDetailed('Cargo', 'INCHEON_CARGO_SERVICE_KEY');
const incheonPassengerDetail = incheonDetailed('Passenger', 'INCHEON_PASSENGER_SERVICE_KEY');

function incheonFlights(input, env) {
  const action = incheonDirection(input);
  return endpoint(`https://apis.data.go.kr/B551177/statusOfAllFltDeOdp/getFlt${action}DeOdp`, {
    ...commonPortalParameters(input, env.INCHEON_ALL_FLIGHTS_SERVICE_KEY),
    searchDate: incheonSearchDate(input),
    searchFrom: input.fromTime ?? '0000',
    searchTo: input.toTime ?? '2400',
    searchdtCode: 'E',
    passengerOrCargo: 'P',
    airportCode: input.oppositeAirport,
    flightId: iataFlight(input),
  });
}

function incheonCargoToday(input, env) {
  const action = incheonDirection(input);
  if (input.date && input.date !== kstDate()) {
    throw new Error('Incheon same-day cargo accepts today in Korea time. Use detailed cargo for other supported dates.');
  }
  if ((input.page ?? 1) !== 1) throw new Error('Incheon same-day cargo has no pagination. Filter by flight, route, or time.');
  return endpoint(`https://apis.data.go.kr/B551177/StatusOfCargoFlights/getCargo${action}`, {
    serviceKey: env.INCHEON_CARGO_TODAY_SERVICE_KEY,
    from_time: input.fromTime ?? '0000',
    to_time: input.toTime ?? '2400',
    airport: input.oppositeAirport,
    flight_id: iataFlight(input),
    lang: 'K',
    type: input.format ?? 'json',
  });
}

function kacSchedule(input, env) {
  if (input.start || input.end || input.fromTime || input.toTime) {
    throw new Error('KAC schedules accept a date filter. Omit the time filters.');
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
    schDate: (input.date ?? kstDate()).replaceAll('-', ''),
    schDeptCityCode: arrival ? input.oppositeAirport : input.airport,
    schArrvCityCode: arrival ? input.airport : input.oppositeAirport,
    schAirLine: domestic ? ident?.slice(0, 2) : undefined,
    schFlightNum: domestic ? ident?.slice(2) : ident,
  });
}

function kacRealtimeParameters(input, serviceKey) {
  if (input.date || input.start || input.end || input.oppositeAirport || (input.page ?? 1) !== 1) {
    throw new Error('This KAC real-time query does not accept date, route, or pagination filters.');
  }
  if (input.airport && !KAC_AIRPORTS.has(input.airport)) {
    throw new Error('Use a KAC airport IATA code such as GMP, PUS or CJU, or omit the airport filter.');
  }
  return {
    serviceKey,
    schLineType: { domestic: 'D', international: 'I' }[input.market],
    schIOType: { arrival: 'I', departure: 'O' }[input.direction],
    schAirCode: input.airport,
    schStTime: input.fromTime,
    schEdTime: input.toTime,
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

function airLabsFlight(input, env) {
  checkLiveWindow(input, 'AirLabs', false);
  if (!input.ident) throw new Error('Supply a flight number.');
  if ((input.page ?? 1) !== 1) throw new Error('AirLabs single-flight lookup returns a single result.');
  return endpoint('https://airlabs.co/api/v9/flight', {
    api_key: env.AIRLABS_API_KEY,
    ...flightFields(input),
  });
}

function airLabsSchedule(input, env) {
  checkLiveWindow(input, 'AirLabs');
  if (!input.ident && !input.airport) throw new Error('Supply a flight number or airport for AirLabs schedules.');
  return endpoint('https://airlabs.co/api/v9/schedules', {
    api_key: env.AIRLABS_API_KEY,
    ...flightFields(input),
    ...airportFields(input),
    ...offsetPage(input, 50),
  });
}

function aviationstackFlights(input, env) {
  checkLiveWindow(input, 'Aviationstack');
  if (!input.ident && !input.airport) throw new Error('Supply a flight number or airport for Aviationstack.');
  if ([input.airport, input.oppositeAirport].some((airport) => airport && !/^[A-Z]{3}$/.test(airport))) {
    throw new Error('Use three-letter IATA airport codes for Aviationstack.');
  }
  return endpoint('https://api.apilayer.net/aviationstack/v1/flights', {
    access_key: env.AVIATIONSTACK_API_KEY,
    ...flightFields(input),
    ...airportFields(input),
    ...offsetPage(input, 100),
  });
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
    note: 'Live status by IATA flight number for the 14 KAC airports. A KAC IATA airport filter is optional. Omit date. Use an Encoding or Decoding service key. Development quota is 5,000 per day.',
    formats: ['json', 'xml'],
    keys: ['KAC_FLIGHT_SEARCH_SERVICE_KEY'],
    limits: [{ requests: 5_000, windowMs: DAY_MS }],
    operations: { flight: kacFlight },
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
    routeOperations: ['flight', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonCargo, airport: incheonCargo, schedule: incheonCargo },
  },
  {
    id: 'incheon_passenger',
    label: 'Incheon Airport detailed flight status',
    docs: 'https://www.data.go.kr/data/15140153/openapi.do',
    note: 'ICN passenger arrivals or departures from the detailed aircraft operations API, KST D−3 to D+6 as available. Set direction. Date defaults to today in KST. Use an Encoding or Decoding service key. Development quota is 500 per day.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_ALL_FLIGHTS_SERVICE_KEY'],
    routeOperations: ['flight', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonFlights, airport: incheonFlights, schedule: incheonFlights },
  },
  {
    id: 'incheon_passenger_detail',
    label: 'Incheon Airport dedicated passenger flight status',
    docs: 'https://www.data.go.kr/data/15112968/openapi.do',
    note: 'ICN passenger arrivals or departures, KST D−3 to D+6 as available. Set direction. Date defaults to today in KST. Use an Encoding or Decoding service key. Development quota is 500 per day.',
    formats: ['json', 'xml'],
    keys: ['INCHEON_PASSENGER_SERVICE_KEY'],
    routeOperations: ['flight', 'airport', 'schedule'],
    limits: [{ requests: 500, windowMs: DAY_MS }],
    operations: { flight: incheonPassengerDetail, airport: incheonPassengerDetail, schedule: incheonPassengerDetail },
  },
  {
    id: 'airlabs',
    label: 'AirLabs',
    docs: 'https://airlabs.co/docs/schedules',
    note: 'A single nearest flight or a live schedule up to 10 hours ahead. Free keys allow 1,000 requests per month, up to 50 schedule results per request, and limited fields.',
    keys: ['AIRLABS_API_KEY'],
    routeOperations: ['airport', 'schedule'],
    limits: [{ requests: 1_000, windowMs: MONTH_MS }],
    operations: { flight: airLabsFlight, airport: airLabsSchedule, schedule: airLabsSchedule },
  },
  {
    id: 'aviationstack',
    label: 'Aviationstack',
    docs: 'https://docs.apilayer.com/aviationstack/docs/api-documentation',
    note: 'Real-time flights on the 100-requests-per-month free personal plan. Date-based history and future schedules require paid access.',
    keys: ['AVIATIONSTACK_API_KEY'],
    routeOperations: ['flight', 'airport'],
    limits: [{ requests: 100, windowMs: MONTH_MS }],
    operations: { flight: aviationstackFlights, airport: aviationstackFlights },
  },
];

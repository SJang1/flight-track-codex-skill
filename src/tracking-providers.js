import { retryAfterMs } from './quota.js';
import { airportTimeZone, hasTimeFilter, localTimeWindow, timeWindow } from './lookup-time.js';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 31 * DAY;

const ADSB_LOL = 'https://api.adsb.lol';
const ADSB_FI = 'https://opendata.adsb.fi/api';
const AVIOADSB = 'https://avioadsb.org/v1';
const ADSB_AERO = 'https://adsb.aero/api/v1';
const OPENSKY = 'https://opensky-network.org/api';
const FLIGHTAWARE = 'https://aeroapi.flightaware.com/aeroapi';
const AERODATABOX = 'https://api.aerodatabox.com';

const flightSearchTypes = {
  flight_number: 'number',
  iata: 'number',
  icao: 'number',
  callsign: 'callsign',
  registration: 'reg',
  icao24: 'icao24',
};

function get(base, path, headers, parameters = {}) {
  const url = new URL(`${base}${path}`);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return { url, headers };
}

function keyHeader(env, variable, header = 'X-API-Key') {
  return env[variable]?.trim() ? { [header]: env[variable].trim() } : {};
}

function asHex(input) {
  if (input.identType !== 'icao24' || !/^[\da-f]{6}$/i.test(input.ident ?? '')) return null;
  return input.ident.toLowerCase();
}

function adsbPath(input, registrationPath) {
  if (input.identType === 'icao24') {
    const icao = asHex(input);
    return icao ? `/hex/${icao}` : null;
  }
  if (input.identType === 'callsign' && /^[\da-z]{1,8}$/i.test(input.ident ?? '')) {
    return `/callsign/${encodeURIComponent(input.ident.toUpperCase())}`;
  }
  if (input.identType === 'registration' && /^[\da-z-]{1,12}$/i.test(input.ident ?? '')) {
    return `/${registrationPath}/${encodeURIComponent(input.ident.toUpperCase())}`;
  }
  return null;
}

function checkAircraftFilters(input, provider) {
  if (input.direction || input.market) {
    throw new Error(`${provider} cannot use direction or market to filter an aircraft lookup. Use an airport movement lookup.`);
  }
}

function checkPageSelection(input, provider, acceptsCursor = false) {
  if ((input.page ?? 1) > 1 || (input.cursor && !acceptsCursor)) {
    throw new Error(acceptsCursor ? `${provider} uses a cursor without a page number.` : `${provider} does not support pagination on this endpoint.`);
  }
}

function aircraftRequest(input, request) {
  if (!input.airport) return request;
  return { ...request, routeFilterNote: 'The airport code is context for this aircraft lookup. Use airport movements to filter by airport.' };
}

function liveAdsb(input, provider, base, prefix, registrationPath, headers) {
  checkAircraftFilters(input, provider);
  checkPageSelection(input, provider);
  if (hasTimeFilter(input)) throw new Error(`${provider} provides current positions on this endpoint. Use a history lookup for dated data.`);
  const path = adsbPath(input, registrationPath);
  if (!path) throw new Error(`${provider} needs an actual ADS-B callsign, registration or six-digit ICAO24 address.`);
  if (input.limit && input.identType !== 'icao24') throw new Error(`${provider} has no result limit for this identifier. Use one ICAO24 address to select a single aircraft.`);
  return aircraftRequest(input, get(base, `${prefix}${path}`, headers));
}

function nearbyCoordinates(input, provider, maximumRadius) {
  const { latitude, longitude, radiusNm } = input;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error(`${provider} requires latitude and longitude in WGS84 degrees.`);
  }
  if (!Number.isFinite(radiusNm) || radiusNm <= 0 || radiusNm > maximumRadius) {
    throw new Error(`${provider} accepts a positive radius up to ${maximumRadius} nautical miles for this lookup.`);
  }
  return { latitude, longitude, radiusNm };
}

function nearbyAdsb(input, provider, base, prefix, headers, maximumRadius) {
  const { latitude, longitude, radiusNm } = nearbyCoordinates(input, provider, maximumRadius);
  if (input.limit != null && input.limit !== 1) throw new Error(`${provider} supports limit: 1 for the nearest aircraft. Omit limit for all results within the radius.`);
  const endpoint = input.limit === 1 ? 'closest' : 'point';
  return get(base, `${prefix}/${endpoint}/${latitude}/${longitude}/${radiusNm}`, headers);
}

function avioExtendedAircraft(input, env) {
  const icao24 = asHex(input);
  if (!icao24) throw new Error('AvioADSB needs an ICAO24 address for its extended aircraft observation.');
  return {
    ...get(AVIOADSB, `/extended/${icao24}`, keyHeader(env, 'AVIOADSB_API_KEY')),
    timeFilterNote: 'AvioADSB supplies an extended live observation for aircraft it can currently see, including identification and telemetry fields.',
  };
}

function moment(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && Math.abs(value) <= 8.64e12 ? value * SECOND : null;
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && moment(value) !== null && new Date(value).toISOString().slice(0, 10) === value;
}

function openSkyRange(input) {
  const range = timeWindow(input);
  if (!range) throw new Error('Supply a date or both start and end for an OpenSky history window.');
  if (range.end - range.begin > 2 * DAY) throw new Error('This OpenSky history endpoint accepts at most two days per request.');
  const begin = Math.ceil(range.begin / SECOND);
  const end = Math.floor(range.end / SECOND);
  if (end <= begin) throw new Error('OpenSky flight windows must contain an interval in whole seconds.');
  return { begin, end };
}

function openSkyAircraft(input) {
  checkAircraftFilters(input, 'OpenSky');
  checkPageSelection(input, 'OpenSky');
  const icao24 = asHex(input);
  if (!icao24) throw new Error('OpenSky needs a six-digit ICAO24 address for aircraft lookups.');
  return icao24;
}

function openSkyTime(input, maxAge, purpose) {
  if (input.date || input.end || input.fromTime || input.toTime) {
    throw new Error(`An OpenSky ${purpose} uses one explicit timestamp in start. Use history for a time range.`);
  }
  if (!input.start) return undefined;
  const instant = Date.parse(input.start);
  const age = Date.now() - instant;
  if (!Number.isFinite(age) || age < 0 || age > maxAge) {
    throw new Error(`Supply an OpenSky ${purpose} timestamp within the ${maxAge === HOUR ? 'past hour' : 'past 30 days'}.`);
  }
  return Math.floor(instant / SECOND);
}

function openSkyTrack(input) {
  const icao24 = openSkyAircraft(input);
  const time = openSkyTime(input, 30 * DAY, 'track');
  return aircraftRequest(input, get(OPENSKY, '/tracks/all', {}, { icao24, time: time ?? 0 }));
}

async function authorizeOpenSky(_input, env, fetch) {
  const tokenEndpoint = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
  const failure = (diagnostic, details) => Object.assign(new Error('OpenSky authorization failed'), { diagnostic, ...details });
  let response;
  try {
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      redirect: 'manual',
      timeoutMs: 20_000,
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.OPENSKY_CLIENT_ID.trim(),
        client_secret: env.OPENSKY_CLIENT_SECRET.trim(),
      }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw failure('oauth_timeout');
    const code = error?.cause?.code ?? error?.code;
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    let transportDiagnostic;
    if (message === 'network connection lost' || code === 'ECONNRESET') transportDiagnostic = 'connection_lost';
    if (message === 'dns lookup failed' || ['ENOTFOUND', 'EAI_AGAIN'].includes(code)) transportDiagnostic = 'dns_error';
    if (['tls handshake failed', 'ssl handshake failed'].includes(message) ||
        ['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) transportDiagnostic = 'tls_error';
    throw failure('oauth_transport_failed', { transportDiagnostic });
  }
  if (!response.ok) {
    const diagnostic = response.status === 522 ? 'oauth_origin_connection_timeout' : 'oauth_http_error';
    throw failure(diagnostic, { response });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw failure(error?.name === 'TimeoutError' ? 'oauth_timeout' : 'oauth_invalid_response', { response });
  }
  const accessToken = payload?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) throw failure('oauth_missing_access_token', { response });
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

const flightAwareId = /^[\da-z-]+-\d{9,11}-[\da-z-]+$/i;
const flightAwareHistoryStart = Date.parse('2011-01-01T00:00:00Z');

function checkReferenceFilters(input, airportLookup = false) {
  if (hasTimeFilter(input) || input.direction || input.oppositeAirport || input.market || input.cursor ||
      input.limit != null || (input.page ?? 1) !== 1 || (airportLookup ? input.ident : input.airport)) {
    throw new Error('Supply one reference identifier without flight, time or pagination filters.');
  }
}

function flightAwareReference(input, env, path, code, validCode, airportLookup = false) {
  checkReferenceFilters(input, airportLookup);
  if (!validCode.test(code ?? '')) return null;
  return get(FLIGHTAWARE, `${path}/${encodeURIComponent(code.toUpperCase())}`, keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'));
}

function flightAwareLastFlight(input, env) {
  if (env.FLIGHTAWARE_HISTORY !== 'true') throw new Error('Enable FLIGHTAWARE_HISTORY only with an AeroAPI plan that includes historical access.');
  if (input.identType !== 'registration') throw new Error('Supply the aircraft registration for its last known AeroAPI flight.');
  const registration = input.ident;
  checkReferenceFilters(input);
  if (!/^[A-Z0-9-]{2,12}$/i.test(registration ?? '')) return null;
  return get(FLIGHTAWARE, `/history/aircraft/${encodeURIComponent(registration.toUpperCase())}/last_flight`,
    keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'));
}

function flightAwareRange(input, required = false) {
  const range = timeWindow(input);
  if (!range && (hasTimeFilter(input) || required)) throw new Error('Supply a date or both start and end for an AeroAPI flight time range.');
  return range;
}

function flightAwareCollection(input, env, path, range, filters = {}) {
  if (input.market || input.limit != null || (input.page ?? 1) !== 1) {
    throw new Error('AeroAPI collections use an opaque cursor and return one page by default. They do not accept numeric pages, a row limit, or domestic/international filters.');
  }
  return get(FLIGHTAWARE, path, keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'), {
    ...filters,
    start: range ? new Date(range.begin).toISOString() : undefined,
    end: range ? new Date(range.end).toISOString() : undefined,
    cursor: input.cursor,
  });
}

function flightAwareQuery(input, env, prefix, requireRange = false) {
  const identType = {
    flight_number: 'designator', iata: 'designator', icao: 'designator', callsign: 'designator',
    registration: 'registration', provider_id: 'fa_flight_id',
  }[input.identType];
  const byId = identType === 'fa_flight_id';
  if (!identType || !(byId ? flightAwareId : /^[A-Z0-9-]{2,12}$/i).test(input.ident ?? '')) return null;
  if (byId && (hasTimeFilter(input) || input.cursor)) throw new Error('A FlightAware flight ID already selects an instance. Supply the ID without time or cursor filters.');
  const range = flightAwareRange(input, requireRange && !byId);
  if (range && input.direction === 'arrival') {
    throw new Error('AeroAPI flight identifiers use scheduled departure time. Use an airport arrival lookup for an arrival time window.');
  }
  const ident = byId ? input.ident : input.ident.toUpperCase();
  const request = flightAwareCollection(input, env, `${prefix}/flights/${encodeURIComponent(ident)}`, range, { ident_type: identType });
  if (range) request.timeFilterBasis = 'scheduled_departure';
  if (input.airport) request.routeFilterNote = 'AeroAPI looked up the flight identifier. This endpoint has no airport filter.';
  return request;
}

function flightAwareInstance(input, env, suffix) {
  if (input.identType !== 'provider_id' || !flightAwareId.test(input.ident ?? '')) {
    throw new Error('Supply an AeroAPI fa_flight_id as provider_id.');
  }
  if (input.start || input.end || input.fromTime || input.toTime || (suffix === 'position' && input.date) ||
      input.airport || input.oppositeAirport || input.direction || input.market || input.cursor || input.limit != null || (input.page ?? 1) !== 1) {
    throw new Error('This AeroAPI endpoint selects one flight by provider ID. Use flight or history for a time range.');
  }
  const historicalRoute = suffix === 'route' && input.date && Date.parse(input.date) < Date.now() - 10 * DAY;
  if (historicalRoute && env.FLIGHTAWARE_HISTORY !== 'true') {
    throw new Error('A historical filed route requires FLIGHTAWARE_HISTORY and a compatible AeroAPI plan.');
  }
  const historical = historicalRoute || (suffix === 'track' && input.date && env.FLIGHTAWARE_HISTORY === 'true');
  const prefix = historical ? '/history' : '';
  const request = get(FLIGHTAWARE, `${prefix}/flights/${encodeURIComponent(input.ident)}/${suffix}`,
    keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'));
  if (suffix === 'route') request.routeFilterNote = 'AeroAPI returned the filed flight route.';
  return request;
}

function flightAwareAirport(input, env) {
  if (!/^[A-Z0-9]{3,4}$/.test(input.airport ?? '')) return null;
  if (input.ident) throw new Error('AeroAPI airport lookups cannot filter by a flight identifier.');
  const range = flightAwareRange(input);
  if (input.oppositeAirport) {
    if (!input.direction) throw new Error('Set direction to identify the origin of this AeroAPI route.');
    if (range && input.direction === 'arrival') {
      throw new Error('The AeroAPI route endpoint has no documented arrival-time filter. Use an airport arrival lookup for that window.');
    }
    const [from, to] = input.direction === 'departure' ? [input.airport, input.oppositeAirport] : [input.oppositeAirport, input.airport];
    const request = flightAwareCollection(input, env, `/airports/${from}/flights/to/${to}`, range, { connection: range ? undefined : 'nonstop' });
    if (range) request.timeFilterNote = 'AeroAPI applied the route time window. Its route documentation does not specify which flight timestamp it matches.';
    return request;
  }
  const direction = { arrival: 'arrivals', departure: 'departures' }[input.direction];
  const now = Date.now();
  if (direction && range && range.begin < now && range.end > now) {
    throw new Error('AeroAPI has separate completed and scheduled movements. Choose a window ending before or starting after now for a directional lookup.');
  }
  const future = range && range.begin >= now;
  const movement = direction ? `${future ? 'scheduled_' : ''}${direction}` : '';
  const request = flightAwareCollection(input, env, `/airports/${input.airport}/flights${movement ? `/${movement}` : ''}`, range);
  if (range && movement) {
    request.timeFilterBasis = {
      arrivals: 'actual_on', departures: 'actual_off', scheduled_arrivals: 'estimated_on', scheduled_departures: 'scheduled_off',
    }[movement];
  }
  return request;
}

function flightAwareHistoricalAirport(input, env) {
  if (env.FLIGHTAWARE_HISTORY !== 'true') throw new Error('Enable FLIGHTAWARE_HISTORY only with an AeroAPI plan that includes historical access.');
  if (!/^[A-Z0-9]{3,4}$/.test(input.airport ?? '') || !input.direction || input.ident) {
    throw new Error('Supply an airport and arrival or departure for AeroAPI historical airport movements.');
  }
  if (input.oppositeAirport && input.direction !== 'departure') {
    throw new Error('AeroAPI historical route time filters use scheduled departure. Supply the origin as airport with direction departure.');
  }
  const range = flightAwareRange(input, true);
  if (range.begin < flightAwareHistoryStart || range.end > Date.now() || range.end - range.begin > DAY) {
    throw new Error('AeroAPI historical airport windows must be entirely in the past since 2011 and span at most 24 hours.');
  }
  const movement = input.oppositeAirport ? `to/${input.oppositeAirport}` : `${input.direction}s`;
  const request = flightAwareCollection(input, env, `/history/airports/${input.airport}/flights/${movement}`, range);
  request.timeFilterBasis = input.direction === 'arrival' ? 'scheduled_on' : 'scheduled_off';
  return request;
}

function flightAwareSchedule(input, env) {
  const range = flightAwareRange(input, true);
  if (range.end - range.begin > 21 * DAY) throw new Error('AeroAPI published schedules accept at most 21 days per request.');
  if ((input.airport && input.direction !== 'departure') || (input.oppositeAirport && !input.airport) || input.direction === 'arrival') {
    throw new Error('AeroAPI published schedules use a departure-time range. Specify the origin as airport and use direction departure.');
  }
  const byFlightNumber = ['flight_number', 'iata', 'icao'].includes(input.identType);
  const flight = byFlightNumber ? /^(?<airline>[A-Z]{3}|[A-Z0-9]{2})(?<number>\d{1,4})$/.exec(input.ident ?? '') : null;
  if ((input.ident && !flight) || (!flight && !input.airport)) {
    throw new Error('Supply a complete IATA or ICAO flight number or an origin airport for AeroAPI published schedules.');
  }
  const dates = [range.begin, range.end].map((instant) => encodeURIComponent(new Date(instant).toISOString()));
  const request = flightAwareCollection(input, env, `/schedules/${dates.join('/')}`, null, {
    origin: input.airport,
    destination: input.oppositeAirport,
    airline: flight?.groups.airline,
    flight_number: flight ? Number(flight.groups.number) : undefined,
  });
  request.timeFilterBasis = 'scheduled_departure';
  return request;
}

function aeroDataBoxHeaders(input, env) {
  return {
    ...keyHeader(env, 'AERODATABOX_API_KEY'),
    ...(input.format === 'xml' ? { Accept: 'application/xml' } : {}),
  };
}

function aeroDataBoxAircraft(input, env, registrations = false) {
  checkReferenceFilters(input);
  const selectors = { registration: 'reg', icao24: 'icao24', provider_id: 'id' };
  const search = selectors[input.identType];
  const valid = search === 'icao24' ? /^[\da-f]{6}$/i : /^[\da-z-]{1,10}$/i;
  if (!search || !valid.test(input.ident ?? '')) throw new Error('Supply an aircraft registration, six-digit ICAO24, or AeroDataBox aircraft ID.');
  const suffix = registrations ? '/registrations' : '';
  return get(AERODATABOX, `/aircrafts/${search}/${encodeURIComponent(input.ident)}${suffix}`, aeroDataBoxHeaders(input, env));
}

function aeroDataBoxAirport(input, env, runways = false) {
  checkReferenceFilters(input, true);
  const code = input.airport;
  if (!/^[A-Z]{3,4}$/i.test(code ?? '')) return null;
  const codeType = code.length === 3 ? 'iata' : 'icao';
  return get(AERODATABOX, `/airports/${codeType}/${code.toUpperCase()}${runways ? '/runways' : ''}`, aeroDataBoxHeaders(input, env));
}

function aeroDataBoxFlightDates(input, env) {
  checkAeroDataBoxFilters(input);
  if (input.airport || input.oppositeAirport || input.direction === 'arrival' || hasTimeFilter(input)) {
    throw new Error('AeroDataBox departure dates use a flight identifier and local dates without airport or clock filters.');
  }
  const search = flightSearchTypes[input.identType];
  const valid = search === 'icao24' ? /^[\da-f]{6}$/i : /^[\da-z-]{1,10}$/i;
  if (!search || !valid.test(input.ident ?? '') || !dateOnly(input.fromDate) || !dateOnly(input.toDate) || input.toDate < input.fromDate) {
    throw new Error('Supply a flight identifier and ordered local departure dates in fromDate and toDate.');
  }
  const request = get(AERODATABOX, `/flights/${search}/${encodeURIComponent(input.ident)}/dates/${input.fromDate}/${input.toDate}`,
    aeroDataBoxHeaders(input, env));
  request.timeFilterBasis = 'local_departure_date';
  return request;
}

function checkAeroDataBoxFilters(input) {
  if (input.market || input.cursor || input.limit != null || (input.page ?? 1) !== 1) {
    throw new Error('This AeroDataBox endpoint does not accept domestic/international or pagination filters.');
  }
}

function aeroDataBoxFlight(input, env) {
  const searchBy = flightSearchTypes[input.identType];
  if (!searchBy || !/^[\da-z-]{1,10}$/i.test(input.ident ?? '')) return null;
  checkAeroDataBoxFilters(input);
  const filedRoute = input.operation === 'filed_route';
  if (filedRoute && (searchBy !== 'number' || !hasTimeFilter(input))) {
    throw new Error('Supply a flight number with its operating date for an AeroDataBox filed flight plan.');
  }
  if (input.operation === 'live' && hasTimeFilter(input)) {
    throw new Error('AeroDataBox live position requires an aircraft or flight identifier without a time window.');
  }
  const airportClockBounds = Boolean(input.fromTime || input.toTime);
  if (airportClockBounds && (input.operation !== 'flight' || searchBy !== 'number')) {
    throw new Error('AeroDataBox exact flight lookups accept local dates only. Use an airport lookup for a time-of-day window.');
  }
  const lookup = airportClockBounds ? { ...input, fromTime: undefined, toTime: undefined } : input;
  let datePath = '';
  let multiDay = false;
  const targetZone = airportTimeZone({ airport: input.airport }) ?? input.timeZone;
  if (input.date != null && (!input.timeZone || input.timeZone === targetZone)) {
    if (!dateOnly(input.date)) return null;
    datePath = `/${input.date}`;
  } else if (hasTimeFilter(lookup)) {
    const { from, to } = localTimeWindow(lookup, targetZone);
    if (![from, to].every((time) => time.endsWith('T00:00:00')) || [input.start, input.end].some((time) => Date.parse(time) % SECOND)) {
      throw new Error('AeroDataBox exact flight ranges must cover whole local dates. Use an airport lookup for narrower times.');
    }
    const firstDate = from.slice(0, 10);
    const lastDate = new Date(Date.parse(to.slice(0, 10)) - DAY).toISOString().slice(0, 10);
    multiDay = firstDate !== lastDate;
    datePath = multiDay ? `/${firstDate}/${lastDate}` : `/${firstDate}`;
  }
  if (filedRoute && (multiDay || !datePath)) throw new Error('AeroDataBox filed flight plans use the single-day flight endpoint.');
  const request = get(AERODATABOX, `/flights/${searchBy}/${encodeURIComponent(input.ident)}${datePath}`,
    aeroDataBoxHeaders(input, env), {
      withLocation: input.operation === 'live' ? true : undefined,
      withFlightPlan: filedRoute ? true : undefined,
      dateLocalRole: { arrival: 'Arrival', departure: 'Departure' }[input.direction],
    });
  if (input.airport) request.routeFilterNote = 'AeroDataBox looked up the flight identifier. This endpoint does not filter by airport.';
  if (filedRoute) {
    request.routeFilterNote = 'AeroDataBox requested the filed flight plan. Availability depends on flight coverage and the subscribed plan.';
  }
  if (!airportClockBounds) return request;
  return {
    ...request,
    timeFilterNote: input.date
      ? 'AeroDataBox searched the selected local flight date. Its flight-number endpoint does not apply airport movement clock bounds.'
      : 'AeroDataBox searched the nearest operating date. Its flight-number endpoint does not apply airport movement clock bounds.',
  };
}

function aeroDataBoxAirportFlights(input, env) {
  if (!/^[A-Z]{3,4}$/i.test(input.airport ?? '')) return null;
  if (input.ident) throw new Error('The AeroDataBox airport board cannot filter by flight identifier.');
  checkAeroDataBoxFilters(input);
  const code = input.airport.toUpperCase();
  const codeType = code.length === 3 ? 'iata' : 'icao';
  let range = '';
  if (hasTimeFilter(input)) {
    const targetZone = airportTimeZone({ airport: code }) ?? input.timeZone;
    const { from, to } = localTimeWindow(input, targetZone);
    if ([from, to].some((time) => !time.endsWith(':00')) || [input.start, input.end].some((time) => Date.parse(time) % MINUTE) || from >= to) {
      throw new Error('AeroDataBox airport boards need an ordered airport-local range at minute precision.');
    }
    range = `/${encodeURIComponent(from.slice(0, 16))}/${encodeURIComponent(to.slice(0, 16))}`;
  }
  return get(AERODATABOX, `/flights/airports/${codeType}/${code}${range}`, aeroDataBoxHeaders(input, env), {
    direction: { arrival: 'Arrival', departure: 'Departure' }[input.direction], withLeg: true,
  });
}

function adsbAeroHistory(input) {
  checkAircraftFilters(input, 'adsb.aero');
  checkPageSelection(input, 'adsb.aero', true);
  let match;
  if (input.identType === 'icao24' && asHex(input)) match = { icao24: [asHex(input)] };
  else if (input.identType === 'callsign' && /^[\da-z]{1,8}$/i.test(input.ident ?? '')) {
    match = { callsign_prefix: input.ident };
  } else if (input.identType === 'registration' && /^[\da-z-]{1,12}$/i.test(input.ident ?? '')) {
    match = { registration_prefix: input.ident };
  }
  if (!match) throw new Error('adsb.aero needs an actual ADS-B callsign, aircraft registration or six-digit ICAO24 address.');
  const range = timeWindow(input);
  if (!range && hasTimeFilter(input)) throw new Error('Supply both start and end for an adsb.aero time range.');
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 100) : 25;
  const body = { match, limit, include_path: false };
  if (range) {
    body.end_date = new Date(range.end).toISOString();
    body.start_from = new Date(range.begin).toISOString();
  }
  if (input.cursor) body.cursor = input.cursor;
  return aircraftRequest(input, {
    url: new URL(`${ADSB_AERO}/query`),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(range ? { timeFilterBasis: 'start_ts' } : {}),
    ...(input.identType !== 'icao24' ? { identityFilterNote: 'adsb.aero matches callsign and registration by prefix. Check the full identifier in each record.' } : {}),
  });
}

export const trackingProviders = [
  {
    id: 'adsb_fi',
    label: 'adsb.fi',
    docs: 'https://github.com/adsbfi/opendata#usage',
    note: 'Public aircraft lookup at one request per second. Personal, non-commercial use with adsb.fi attribution.',
    keys: [],
    limits: [{ requests: 1, windowMs: SECOND }],
    operations: {
      live: (input) => liveAdsb(input, 'adsb.fi', ADSB_FI, '/v2', 'registration'),
      nearby(input) {
        const { latitude, longitude, radiusNm } = nearbyCoordinates(input, 'adsb.fi', 250);
        if (input.limit != null) throw new Error('adsb.fi radial lookups do not accept a result limit. Use a smaller radius.');
        return get(ADSB_FI, `/v3/lat/${latitude}/lon/${longitude}/dist/${radiusNm}`);
      },
    },
  },
  {
    id: 'adsb_lol',
    label: 'adsb.lol',
    docs: 'https://www.adsb.lol/docs/open-data/api',
    note: 'ODbL 1.0. This integration requires ADSB_LOL_API_KEY. Tracks use the stored full daily trace by default, or the most recent points with trackScope: recent. Airport reference requires an ICAO code. Set ADSB_LOL_TIER to adhoc or feeder for the corresponding key allowance.',
    keys: ['ADSB_LOL_API_KEY'],
    trackScopes: ['recent', 'full'],
    airportInfoOnly: true,
    airportInfo(input, env) {
      const icao = input.airport === 'ICN' ? 'RKSI' : input.airport;
      if (!/^[A-Z]{4}$/.test(icao ?? '')) throw new Error('Supply a four-letter ICAO airport code for adsb.lol airport reference.');
      return get(ADSB_LOL, `/api/0/airport/${icao}`, keyHeader(env, 'ADSB_LOL_API_KEY'));
    },
    limits(_input, env) {
      if (env.ADSB_LOL_TIER === 'feeder') {
        return [
          { requests: 72, windowMs: 30 * SECOND },
          { requests: 144, windowMs: MINUTE },
          { requests: 7_200, windowMs: HOUR },
          { requests: 7_200, windowMs: DAY },
          { requests: 18_000, windowMs: 7 * DAY },
          { requests: 72_000, windowMs: MONTH },
        ];
      }
      return [{ requests: env.ADSB_LOL_TIER === 'adhoc' ? 1_000 : 500, windowMs: DAY }];
    },
    operations: {
      live: (input, env) => liveAdsb(input, 'adsb.lol', ADSB_LOL, '/v2', 'reg', keyHeader(env, 'ADSB_LOL_API_KEY')),
      nearby(input, env) {
        if (!Number.isInteger(input.radiusNm)) throw new Error('adsb.lol requires a radius in whole nautical miles.');
        return nearbyAdsb(input, 'adsb.lol', ADSB_LOL, '/v2', keyHeader(env, 'ADSB_LOL_API_KEY'), 250);
      },
      track(input, env) {
        checkAircraftFilters(input, 'adsb.lol');
        checkPageSelection(input, 'adsb.lol');
        const icao = asHex(input);
        if (!icao) throw new Error('adsb.lol needs a six-digit ICAO24 address for a track.');
        if (hasTimeFilter(input)) throw new Error('This adsb.lol trace endpoint cannot filter by date or time.');
        const scope = input.trackScope === 'recent' ? 'recent' : 'full';
        const request = get(ADSB_LOL, `/1/trace/${scope}/${icao}`, keyHeader(env, 'ADSB_LOL_API_KEY'));
        return aircraftRequest(input, {
          ...request,
          timeFilterNote: scope === 'recent'
            ? 'This is the tail of the stored trace for one aircraft.'
            : 'This is the stored daily trace for one aircraft. It can include more than one flight leg.',
        });
      },
    },
  },
  {
    id: 'avioadsb',
    label: 'AvioADSB',
    docs: 'https://avioadsb.org/docs/api',
    note: 'CC BY-NC 4.0. Aircraft details by ICAO24 are live extended observations. Inactive contributor keys use the documented anonymous limits.',
    keys: [],
    optionalKeys: ['AVIOADSB_API_KEY'],
    limits(_input, env, response) {
      const tier = response?.headers?.get('X-AvioADSB-Tier');
      if (env.AVIOADSB_API_KEY?.trim() && tier !== 'inactive_key' && tier !== 'anonymous') {
        return [{ requests: 1, windowMs: SECOND }, { requests: 10_000, windowMs: MONTH }];
      }
      return [{ requests: 1, windowMs: 10 * SECOND }, { requests: 100, windowMs: DAY }];
    },
    operations: {
      live: (input, env) => liveAdsb(input, 'AvioADSB', AVIOADSB, '', 'reg', keyHeader(env, 'AVIOADSB_API_KEY')),
      aircraft: avioExtendedAircraft,
      nearby(input, env) {
        return nearbyAdsb(input, 'AvioADSB', AVIOADSB, '', keyHeader(env, 'AVIOADSB_API_KEY'), env.AVIOADSB_API_KEY?.trim() ? 250 : 100);
      },
    },
  },
  {
    id: 'adsb_aero',
    label: 'adsb.aero',
    docs: 'https://adsb.aero/llms.txt',
    note: 'Public archive of observed airborne trajectories. Callsign and registration searches are prefix searches. Local spacing is 30 seconds under the provider’s fair-use guidance.',
    keys: [],
    trackScopes: ['full'],
    limits: [{ requests: 1, windowMs: 30 * SECOND }],
    airportInfoOnly: true,
    airportInfo(input) {
      const code = input.airport;
      if (!/^[A-Z]{3,4}$/.test(code ?? '')) throw new Error('Supply an IATA or ICAO airport code for adsb.aero airport reference.');
      return get(ADSB_AERO, `/airports/${code}`);
    },
    operations: {
      history: adsbAeroHistory,
      track(input) {
        checkAircraftFilters(input, 'adsb.aero');
        checkPageSelection(input, 'adsb.aero');
        if (input.identType !== 'provider_id' || !/^[\da-f]{6}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(input.ident ?? '')) return null;
        if (hasTimeFilter(input)) throw new Error('An adsb.aero track is selected by provider ID. Use history for a time range.');
        return aircraftRequest(input, get(ADSB_AERO, `/flights/${encodeURIComponent(input.ident)}`));
      },
    },
  },
  {
    id: 'opensky',
    label: 'OpenSky Network',
    docs: 'https://openskynetwork.github.io/opensky-api/rest.html',
    note: 'Operational API use requires an OpenSky written agreement. The archive is batch processed. Set OPENSKY_CREDIT_TIER to feeder or licensed for a confirmed higher credit allowance.',
    keys: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    limits(_input, env) {
      if (env.OPENSKY_CREDIT_TIER === 'licensed') return [{ requests: 14_400, windowMs: HOUR }];
      return [{ requests: env.OPENSKY_CREDIT_TIER === 'feeder' ? 8_000 : 4_000, windowMs: DAY }];
    },
    bucket(input) {
      return { live: 'states', track: 'tracks' }[input.operation] ?? 'flights';
    },
    cost(input) {
      if (input.operation === 'live') return 4;
      if (input.operation === 'track') return input.start != null || input.date != null ? 30 : 4;
      const range = timeWindow(input);
      if (!range || range.end - range.begin < DAY) return 4;
      const partitions = Math.floor(range.end / DAY) - Math.floor(range.begin / DAY);
      return partitions > 2 ? 60 * partitions : 30;
    },
    quotaCost(input) {
      return input.operation === 'live' ? 4 : 30;
    },
    authorize: authorizeOpenSky,
    retryAfter(response, now) {
      return retryAfterMs(response.headers.get('X-Rate-Limit-Retry-After-Seconds'), now);
    },
    operations: {
      live(input) {
        const icao24 = openSkyAircraft(input);
        const time = openSkyTime(input, HOUR, 'position snapshot');
        return aircraftRequest(input, {
          ...get(OPENSKY, '/states/all', {}, { icao24, time }),
          ...(time === undefined ? {} : {
            timeFilterBasis: 'state_vector_time',
            timeFilterNote: 'OpenSky rounds authenticated position snapshots down to five-second intervals.',
          }),
        });
      },
      track: openSkyTrack,
      history(input) {
        const icao24 = openSkyAircraft(input);
        if (input.limit) throw new Error('OpenSky aircraft history has no result limit. Use a shorter time range.');
        const range = openSkyRange(input);
        return aircraftRequest(input, { ...get(OPENSKY, '/flights/aircraft', {}, { icao24, ...range }), timeFilterBasis: 'departure_and_arrival' });
      },
      airport(input) {
        const direction = input.direction;
        const airport = input.airport === 'ICN' ? 'RKSI' : input.airport;
        checkPageSelection(input, 'OpenSky');
        if (input.ident) throw new Error('OpenSky airport movements cannot filter by flight identifier.');
        if (input.market || input.limit) throw new Error('OpenSky airport movements accept airport, direction and time. Use a shorter time range to limit results.');
        if (!/^[A-Z]{4}$/i.test(airport ?? '') || !['arrival', 'departure'].includes(direction)) {
          throw new Error('Supply an ICAO airport code and arrival or departure for OpenSky airport movements.');
        }
        const range = openSkyRange(input);
        return { ...get(OPENSKY, `/flights/${direction}`, {}, { airport: airport.toUpperCase(), ...range }), timeFilterBasis: direction };
      },
    },
  },
  {
    id: 'flightaware',
    label: 'FlightAware AeroAPI',
    docs: 'https://www.flightaware.com/commercial/aeroapi/',
    note: 'Usage-based billing per result set. FlightAware approval is required to use AeroAPI data with another live flight-data provider on Personal and Standard plans. Set FLIGHTAWARE_HISTORY=true only if the plan includes historical access.',
    exclusive: true,
    keys: ['FLIGHTAWARE_API_KEY'],
    airportInfoOnly: true,
    airportInfo: (input, env) => flightAwareReference(input, env, '/airports', input.airport, /^[A-Z0-9]{3,4}$/i, true),
    routeOperations: ['airport', 'history', 'schedule'],
    limits: [{ requests: 10, windowMs: MINUTE }],
    operations: {
      flight: (input, env) => flightAwareQuery(input, env, ''),
      live: (input, env) => flightAwareInstance(input, env, 'position'),
      track: (input, env) => flightAwareInstance(input, env, 'track'),
      filed_route: (input, env) => flightAwareInstance(input, env, 'route'),
      history(input, env) {
        if (!input.ident && input.airport) return flightAwareHistoricalAirport(input, env);
        if (input.oppositeAirport) throw new Error('AeroAPI flight-identifier history cannot filter by both route airports.');
        return flightAwareQuery(input, env, env.FLIGHTAWARE_HISTORY === 'true' ? '/history' : '', true);
      },
      schedule: flightAwareSchedule,
      airport: flightAwareAirport,
      aircraft(input, env) {
        if (input.identType !== 'aircraft_type') throw new Error('Supply an ICAO aircraft type designator for AeroAPI aircraft-type information.');
        return flightAwareReference(input, env, '/aircraft/types', input.ident, /^[A-Z0-9]{2,4}$/i);
      },
      airline_info(input, env) {
        const identifier = { iata: /^[A-Z0-9]{2}$/i, icao: /^[A-Z]{3}$/i }[input.identType];
        if (!identifier) throw new Error('Supply an AeroAPI airline identifier as an IATA or ICAO code.');
        return flightAwareReference(input, env, '/operators', input.ident, identifier);
      },
      last_flight: flightAwareLastFlight,
    },
  },
  {
    id: 'aerodatabox',
    label: 'AeroDataBox Direct',
    docs: 'https://doc.aerodatabox.com/direct.html',
    note: 'Direct key only. Flight status and airport boards cost 2 units, date-range flight status costs 6. Feeder credits do not reset. Airport board times use the queried airport’s local clock. Local spacing applies, with an optional confirmed monthly allowance.',
    keys: ['AERODATABOX_API_KEY'],
    formats: ['json', 'xml'],
    airportInfoOnly: true,
    airportInfo: aeroDataBoxAirport,
    limits(_input, env) {
      const units = Number(env.AERODATABOX_MONTHLY_UNITS);
      return Number.isSafeInteger(units) && units > 0
        ? [{ requests: 6, windowMs: 5 * SECOND }, { requests: units, windowMs: MONTH }]
        : [{ requests: 6, windowMs: 5 * SECOND }];
    },
    quotaCost(input) {
      if (['aircraft', 'aircraft_registrations', 'airport_info', 'airport_runways'].includes(input.operation)) return 1;
      return input.operation === 'flight_dates' ? 2 : 6;
    },
    operations: {
      flight: aeroDataBoxFlight,
      live: aeroDataBoxFlight,
      flight_dates: aeroDataBoxFlightDates,
      filed_route: aeroDataBoxFlight,
      history(input, env) {
        if (!hasTimeFilter(input)) return null;
        return input.ident ? aeroDataBoxFlight(input, env) : aeroDataBoxAirportFlights(input, env);
      },
      schedule(input, env) {
        if (!hasTimeFilter(input)) throw new Error('Supply an operating date or time range for an AeroDataBox schedule lookup.');
        return input.ident ? aeroDataBoxFlight(input, env) : aeroDataBoxAirportFlights(input, env);
      },
      airport: aeroDataBoxAirportFlights,
      aircraft: (input, env) => aeroDataBoxAircraft(input, env),
      aircraft_registrations: (input, env) => aeroDataBoxAircraft(input, env, true),
      airport_runways: (input, env) => aeroDataBoxAirport(input, env, true),
    },
  },
];

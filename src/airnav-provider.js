import { hasTimeFilter, timeWindow } from './lookup-time.js';
import { airNavEndpoints } from './airnav-endpoints.js';

const BASE_URL = 'https://api.airnavradar.com/v2';
const DAY_MS = 86_400_000;

function aircraftFilter(input) {
  const ident = input.ident?.toUpperCase();
  if (input.identType === 'icao24' && /^[0-9A-F]{6}$/.test(ident ?? '')) {
    return { modeSHexCodes: [ident] };
  }
  if (input.identType === 'registration' && /^[A-Z0-9-]{1,12}$/.test(ident ?? '')) {
    return { registrations: [ident] };
  }
  if (['flight_number', 'iata', 'icao', 'callsign'].includes(input.identType) && /^[A-Z0-9]{1,8}$/.test(ident ?? '')) {
    return { flightIds: [ident] };
  }
  return null;
}

function dateFilters(input) {
  const range = timeWindow(input);
  if (!range) throw new Error('AirNav search requires date or a complete time window.');
  const fromDate = new Date(range.begin).toISOString();
  const untilMidnight = !input.start && !input.end && (!input.toTime || input.toTime === '2400');
  const toDate = new Date(range.end - (untilMidnight ? 1 : 0)).toISOString();
  if (input.direction === 'arrival') return { arrivalFromDate: fromDate, arrivalToDate: toDate };
  if (input.direction === 'departure') return { departureFromDate: fromDate, departureToDate: toDate };
  return { fromDate, toDate };
}

function request(path, env, parameters = {}) {
  const token = env.AIRNAVRADAR_API_TOKEN?.trim().replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return { url, headers: { Authorization: `Bearer ${token}` } };
}

function post(path, body, env, page) {
  const prepared = request(`/flights/${path}`, env, page === undefined ? {} : { page, pageSize: 1 });
  if (!prepared) return null;
  return {
    ...prepared,
    method: 'POST',
    headers: { ...prepared.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function live(input, env) {
  const filter = aircraftFilter(input);
  if (!filter) return null;
  if (hasTimeFilter(input)) throw new Error('Use flight or history for a timed AirNav search.');
  if (input.market || input.cursor || input.limit != null || (input.page ?? 1) !== 1) {
    throw new Error('AirNav live positions do not accept market or pagination filters, or a result limit.');
  }
  return post('live', { ...filter, ...airportFilters(input) }, env);
}

function search(input, env, filter, includeFlightPaths = false) {
  if (!filter) return null;
  if (input.market || input.cursor) throw new Error('AirNav search accepts a numbered page and does not accept a market filter or cursor.');
  const body = { ...filter, ...airportFilters(input), ...dateFilters(input), includeFlightPaths };
  return post('search', body, env, input.page ?? 1);
}

function schedules(input, env) {
  const range = timeWindow(input);
  if (!range || range.end <= Date.now()) throw new Error('Supply a date or time window for upcoming AirNav schedules.');
  const isExactFlight = [undefined, 'flight_number', 'iata'].includes(input.identType) && /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(input.ident ?? '');
  const fractionalBounds = [input.start, input.end].some((value) => value && Date.parse(value) % 1_000 !== 0);
  if (!isExactFlight || range.end - range.begin > DAY_MS || fractionalBounds || input.limit != null || (input.page ?? 1) !== 1) {
    if (input.ident && !isExactFlight) throw new Error('Supply an IATA flight number for AirNav schedules.');
    if (!input.ident && !input.airport) throw new Error('Supply a flight number or airport for AirNav schedules.');
    return search(input, env, input.ident ? { flightIds: [input.ident] } : {});
  }
  if (input.market || input.cursor) throw new Error('AirNav schedules do not accept a market filter or cursor.');
  if ((input.airport || input.oppositeAirport) && !input.direction) throw new Error('Set direction for an AirNav scheduled airport filter.');
  if (input.oppositeAirport && !input.airport) throw new Error('Supply both airports for an AirNav schedule route.');
  const direction = input.direction ?? 'departure';
  const times = Object.fromEntries(Object.entries(dateFilters({ ...input, direction })).map(([name, value]) => [name, value.replace(/\.\d{3}Z$/, 'Z')]));
  return request('/flights/schedules', env, {
    flightId: input.ident,
    fromAirport: direction === 'departure' ? input.airport : input.oppositeAirport,
    toAirport: direction === 'arrival' ? input.airport : input.oppositeAirport,
    ...times,
  });
}

function aircraft(input, env) {
  if (input.identType === 'icao24' && /^[A-F0-9]{6}$/.test(input.ident)) {
    return request('/aircraft', env, { modeS: input.ident });
  }
  if (input.identType === 'registration' && /^[A-Z0-9-]{1,12}$/.test(input.ident)) {
    return request('/aircraft', env, { registration: input.ident });
  }
  throw new Error('Use one ICAO24 address or registration for an AirNav aircraft lookup.');
}

function airportFilters(input) {
  if (!input.airport) {
    if (input.oppositeAirport) throw new Error('Supply the primary airport for an AirNav route lookup.');
    return {};
  }
  if (!input.direction) {
    if (input.oppositeAirport) throw new Error('Set direction for an AirNav route lookup.');
    return { toOrFromAirports: [input.airport] };
  }

  const airport = input.airport === 'ICN' ? 'RKSI' : input.airport;
  const opposite = input.oppositeAirport === 'ICN' ? 'RKSI' : input.oppositeAirport;
  const icao = /^[A-Z]{4}$/;
  if (!icao.test(airport) || (opposite && !icao.test(opposite))) {
    throw new Error('Use four-letter ICAO airport codes for an AirNav arrival, departure or route lookup.');
  }
  const from = input.direction === 'departure' ? airport : opposite;
  const to = input.direction === 'arrival' ? airport : opposite;
  return {
    ...(from ? { fromAirports: [from] } : {}),
    ...(to ? { toAirports: [to] } : {}),
  };
}

export const airnavProvider = {
  id: 'airnavradar',
  label: 'AirNav Radar On-Demand API',
  docs: 'https://www.airnavradar.com/api/documentation',
  note: 'Search and track use one result per page. Track includes flight paths only when requested. Schedule, aircraft and airport lookups use the AirNav On Demand API. The raw cost field reports charges where provided; the local pacing budget is 100 credits across 31 days.',
  keys: ['AIRNAVRADAR_API_TOKEN'],
  native: {
    baseUrl: BASE_URL,
    endpoints: airNavEndpoints,
    options(_input, env) {
      return { headers: request('', env)?.headers };
    },
  },
  airportInfoOnly: true,
  airportInfo(input, env) {
    return request(`/airports/${encodeURIComponent(input.airport)}`, env);
  },
  routeOperations: ['airport', 'flight', 'history', 'live', 'schedule', 'track'],
  limits: [{ requests: 100, windowMs: 31 * DAY_MS }],
  quotaCost: 1,
  chargedCredits(body) {
    try {
      const cost = JSON.parse(body)?.cost;
      return Number.isSafeInteger(cost) && cost >= 0 && cost <= 100_000 ? cost : undefined;
    } catch {
      return undefined;
    }
  },
  operations: {
    live,
    aircraft,
    schedule: schedules,
    track(input, env) {
      const filter = aircraftFilter(input);
      if (!filter) throw new Error('Supply an exact flight number, callsign, registration or ICAO24 for an AirNav flight path.');
      return search(input, env, filter, true);
    },
    flight(input, env) {
      if (hasTimeFilter(input)) {
        return search(input, env, aircraftFilter(input));
      }
      return live(input, env);
    },
    history(input, env) {
      return search(input, env, aircraftFilter(input));
    },
    airport(input, env) {
      if (!/^[A-Z]{3,4}$/.test(input.airport ?? '')) return null;
      return search(input, env, input.ident === undefined ? {} : aircraftFilter(input));
    },
  },
};

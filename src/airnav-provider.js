import { hasTimeFilter, timeWindow } from './lookup-time.js';

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

function post(path, body, env, page) {
  const token = env.AIRNAVRADAR_API_TOKEN?.trim().replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const url = new URL(`${BASE_URL}/flights/${path}`);
  if (page !== undefined) {
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', '1');
  }
  return {
    url,
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function live(input, env) {
  const filter = aircraftFilter(input);
  if (!filter) return null;
  if (hasTimeFilter(input)) throw new Error('Use flight or history for a timed AirNav search.');
  return post('live', { ...filter, ...airportFilters(input) }, env);
}

function search(input, env, filter) {
  if (!filter) return null;
  const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
  const body = { ...filter, ...airportFilters(input), ...dateFilters(input), page, pageSize: 1, includeFlightPaths: false, includeFlightUrls: true };
  return post('search', body, env, page);
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
  note: 'A local 31-day pacing horizon spreads the 100-credit allowance. The token renewal date is unknown. AirNav bills per result and the raw cost field shows the actual charge. Search returns a single result per page. Live requests are limited to a single exact identifier and can still return multiple records.',
  keys: ['AIRNAVRADAR_API_TOKEN'],
  routeOperations: ['airport', 'flight', 'history', 'live'],
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

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

function timeWindow(input) {
  let from;
  let to;
  if (input.start != null || input.end != null) {
    from = Date.parse(input.start);
    to = Date.parse(input.end);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) {
    from = Date.parse(`${input.date}T00:00:00Z`);
    if (!Number.isFinite(from) || new Date(from).toISOString().slice(0, 10) !== input.date) return null;
    to = from + DAY_MS - 1;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;

  const fromDate = new Date(from).toISOString();
  const toDate = new Date(to).toISOString();
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
  if (!filter || input.date != null || input.start != null || input.end != null) return null;
  return post('live', filter, env);
}

function search(input, env, filter) {
  const window = timeWindow(input);
  if (!filter || !window) return null;
  const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1;
  const body = { ...filter, ...window, page, pageSize: 1, includeFlightPaths: false, includeFlightUrls: true };
  return post('search', body, env, page);
}

function airportSearch(input, env) {
  if (!/^[A-Z]{3,4}$/.test(input.airport ?? '')) return null;
  const aircraft = input.ident === undefined ? {} : aircraftFilter(input);
  if (!aircraft) return null;
  if (!input.direction) {
    if (input.oppositeAirport) throw new Error('Set direction for an AirNav route lookup.');
    return search(input, env, { ...aircraft, toOrFromAirports: [input.airport] });
  }

  const icao = /^[A-Z]{4}$/;
  if (!icao.test(input.airport) || (input.oppositeAirport && !icao.test(input.oppositeAirport))) {
    throw new Error('Use four-letter ICAO airport codes for an AirNav arrival, departure or route lookup.');
  }
  const from = input.direction === 'departure' ? input.airport : input.oppositeAirport;
  const to = input.direction === 'arrival' ? input.airport : input.oppositeAirport;
  return search(input, env, {
    ...aircraft,
    ...(from ? { fromAirports: [from] } : {}),
    ...(to ? { toAirports: [to] } : {}),
  });
}

export const airnavProvider = {
  id: 'airnavradar',
  label: 'AirNav Radar On-Demand API',
  docs: 'https://www.airnavradar.com/api/documentation',
  note: 'A local 31-day pacing horizon spreads the 100-credit allowance. The token renewal date is unknown. AirNav bills per result and the raw cost field shows the actual charge. Search returns a single result per page. Live requests are limited to a single exact identifier and can still return multiple records.',
  keys: ['AIRNAVRADAR_API_TOKEN'],
  routeOperations: ['airport'],
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
      if (input.date != null || input.start != null || input.end != null) {
        return search(input, env, aircraftFilter(input));
      }
      return live(input, env);
    },
    history(input, env) {
      return search(input, env, aircraftFilter(input));
    },
    airport: airportSearch,
  },
};

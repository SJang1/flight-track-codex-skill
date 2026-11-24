import { fr24EndpointCatalog, fr24RequestLimits, fr24RequestOptions } from './fr24-endpoints.js';

const BASE_URL = 'https://fr24api.flightradar24.com/api';
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 10;
const SUMMARY_AVAILABLE_FROM = Date.parse('2022-06-01T00:00:00Z');
const HISTORIC_POSITIONS_AVAILABLE_FROM = Date.parse('2016-05-11T00:00:00Z');
const iataFlightNumber = /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/i;

const identifierFilters = {
  flight_number: ['flights', iataFlightNumber],
  iata: ['flights', iataFlightNumber],
  callsign: ['callsigns', /^[A-Z0-9-]{3,8}$/i],
  registration: ['registrations', /^[A-Z0-9-]{2,12}$/i],
};

function get(endpoint, parameters, env) {
  const key = env.FLIGHTRADAR24_API_KEY?.trim().replace(/^Bearer\s+/i, '');
  if (!key) return null;
  const { path, query } = fr24RequestOptions(endpoint, parameters, env);
  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
  return { url, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Accept-Version': 'v1' } };
}

export function flightradar24Request(input, env) {
  return get(input.fr24Endpoint, input.fr24Params ?? {}, env);
}

function checkOptions(input) {
  if (input.market || input.fromTime || input.toTime || input.cursor || (input.page ?? 1) !== 1) {
    throw new Error('Flightradar24 uses a UTC date or timestamp range and a result limit. Market and pagination filters are unavailable.');
  }
}

function filters(input) {
  const parameters = {};
  if (input.ident != null || input.identType != null) {
    const match = identifierFilters[input.identType];
    if (!match?.[1]?.test(input.ident ?? '')) {
      throw new Error('Supply an IATA flight number, ADS-B callsign, or aircraft registration for Flightradar24.');
    }
    parameters[match[0]] = input.ident;
  }

  const airportCode = /^[A-Z]{3,4}$/;
  if (input.airport != null) {
    if (!airportCode.test(input.airport)) throw new Error('Supply an IATA or ICAO airport code for Flightradar24.');
    if (input.oppositeAirport != null) {
      if (!airportCode.test(input.oppositeAirport) || !input.direction) {
        throw new Error('Supply the other airport code and direction for a Flightradar24 route.');
      }
      parameters.routes = input.direction === 'departure'
        ? `${input.airport}-${input.oppositeAirport}` : `${input.oppositeAirport}-${input.airport}`;
    } else {
      const direction = { departure: 'outbound', arrival: 'inbound' }[input.direction];
      parameters.airports = direction ? `${direction}:${input.airport}` : input.airport;
    }
  } else if (input.oppositeAirport || input.direction || input.operation === 'airport') {
    throw new Error('Supply the primary airport code for Flightradar24.');
  }

  if (!Object.keys(parameters).length) throw new Error('Supply at least one flight or airport filter for Flightradar24.');
  return parameters;
}

function flightId(input) {
  if (input.identType !== 'provider_id' || !/^[\da-f]+$/i.test(input.ident ?? '')) {
    throw new Error('Supply the hexadecimal Flightradar24 fr24_id as provider_id.');
  }
  if (input.date || input.start || input.end || input.airport || input.direction || input.oppositeAirport || input.limit != null) {
    throw new Error('A Flightradar24 provider_id lookup accepts the fr24_id without other flight, date, airport, or result filters.');
  }
  return input.ident;
}

function summaryRange(input) {
  if (input.date && (input.start || input.end)) throw new Error('Supply a UTC date or a start and end for the Flightradar24 flight summary.');
  const from = Date.parse(input.date ? `${input.date}T00:00:00Z` : input.start);
  const to = input.date ? from + DAY_MS - 1_000 : Date.parse(input.end);
  const startSecond = Math.floor(from / 1_000);
  const endSecond = Math.floor(to / 1_000);
  if (!Number.isFinite(startSecond) || !Number.isFinite(endSecond) || endSecond <= startSecond || to - from > 14 * DAY_MS) {
    throw new Error('Supply a UTC date or an ordered Flightradar24 summary window of at most 14 days.');
  }
  if (from < SUMMARY_AVAILABLE_FROM) throw new Error('Flightradar24 flight summaries start on 2022-06-01 UTC, subject to plan coverage.');
  return {
    flight_datetime_from: new Date(startSecond * 1_000).toISOString().replace('.000Z', 'Z'),
    flight_datetime_to: new Date(endSecond * 1_000).toISOString().replace('.000Z', 'Z'),
  };
}

function live(input, env) {
  checkOptions(input);
  if (input.date || input.start || input.end) throw new Error('Use history for dated Flightradar24 positions.');
  return get('live_positions_full', { ...filters(input), limit: input.limit ?? DEFAULT_LIMIT }, env);
}

function history(input, env) {
  checkOptions(input);
  if (input.identType === 'provider_id' && input.operation !== 'airport') {
    return get('flight_summary_light', { flight_ids: flightId(input) }, env);
  }
  if (input.operation === 'history' && input.start && !input.end && !input.date) {
    const timestamp = Date.parse(input.start);
    if (!Number.isFinite(timestamp) || timestamp < HISTORIC_POSITIONS_AVAILABLE_FROM || timestamp >= Date.now()) {
      throw new Error('Supply a historical timestamp on or after 2016-05-11 UTC for a Flightradar24 position snapshot.');
    }
    return get('historic_positions_full', { ...filters(input), timestamp: Math.floor(timestamp / 1_000), limit: input.limit ?? DEFAULT_LIMIT }, env);
  }
  return get('flight_summary_light', { ...filters(input), ...summaryRange(input), limit: input.limit ?? DEFAULT_LIMIT }, env);
}

function flight(input, env) {
  return input.date || input.start || input.end || input.identType === 'provider_id' ? history(input, env) : live(input, env);
}

export const flightradar24Provider = {
  id: 'flightradar24',
  label: 'Flightradar24 API',
  docs: 'https://fr24api.flightradar24.com/docs/endpoints/overview',
  note: 'Participates in eligible flight, live, airport, history, and track lookups when a key is configured. Select this provider explicitly for a narrower lookup. Use operation fr24 for a specific endpoint such as airport details, counts, or usage. FLIGHTRADAR24_PLAN controls coverage and request rate. FLIGHTRADAR24_MONTHLY_CREDITS optionally adds an advisory budget.',
  keys: ['FLIGHTRADAR24_API_KEY'],
  airportInfoRequiresSelection: true,
  airportInfo(input, env) {
    return get('airports_light', { code: input.airport }, env);
  },
  endpointCatalog: fr24EndpointCatalog,
  routeOperations: ['flight', 'live', 'history', 'airport'],
  limits(input, env = {}) {
    if (input.operation === 'airport_info') return fr24RequestLimits('airports_light', {}, env);
    if (input.operation === 'fr24') return fr24RequestLimits(input.fr24Endpoint, input.fr24Params ?? {}, env);
    const usesPositions = input.operation === 'live'
      || (input.operation === 'history' && input.start && !input.end && !input.date && input.identType !== 'provider_id')
      || (['airport', 'flight'].includes(input.operation) && !input.date && !input.start && !input.end && input.identType !== 'provider_id');
    const endpoint = input.operation === 'track' ? 'flight_tracks' : usesPositions ? 'live_positions_full' : 'flight_summary_light';
    const params = input.identType === 'provider_id' ? { flight_ids: input.ident } : { limit: input.limit };
    return fr24RequestLimits(endpoint, params, env);
  },
  operations: {
    flight,
    live,
    history,
    airport: flight,
    fr24: flightradar24Request,
    track(input, env) {
      checkOptions(input);
      return get('flight_tracks', { flight_id: flightId(input) }, env);
    },
  },
};

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
  if (!range || range.end - range.begin > 2 * DAY) return null;
  const begin = Math.ceil(range.begin / SECOND);
  const end = Math.floor(range.end / SECOND);
  return end > begin ? { begin, end } : null;
}

function openSkyTrack(input) {
  const icao24 = asHex(input);
  if (input.fromTime || input.toTime || input.end) throw new Error('An OpenSky track accepts one timestamp in start. Use history for a time range.');
  const time = input.start ? moment(input.start) : timeWindow(input)?.begin ?? 0;
  if (!icao24 || time === null) return null;
  return get(OPENSKY, '/tracks/all', {}, { icao24, time: Math.floor(time / SECOND) });
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

function flightAwareQuery(input, env, prefix, requireRange = false) {
  if (!['flight_number', 'callsign', 'registration'].includes(input.identType) || !/^[A-Z0-9-]{2,12}$/i.test(input.ident ?? '')) return null;
  const identType = { flight_number: 'designator', registration: 'registration' }[input.identType];
  const range = timeWindow(input);
  if (!range && (hasTimeFilter(input) || requireRange)) throw new Error('Supply a date or both start and end for an AeroAPI flight time range.');
  return get(FLIGHTAWARE, `${prefix}/flights/${encodeURIComponent(input.ident.toUpperCase())}`,
    keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'), {
      ident_type: identType,
      max_pages: 1,
      start: range ? new Date(range.begin).toISOString() : undefined,
      end: range ? new Date(range.end).toISOString() : undefined,
    });
}

function flightAwareInstance(input, env, suffix) {
  if (input.identType !== 'provider_id' || !/^[\da-z-]+-\d{9,11}-[\da-z-]+$/i.test(input.ident ?? '')) return null;
  if (input.start || input.end || input.fromTime || input.toTime || (suffix !== 'track' && input.date)) {
    throw new Error('This AeroAPI endpoint selects one flight by provider ID. Use flight or history for a time range.');
  }
  const historical = suffix === 'track' && input.date != null && env.FLIGHTAWARE_HISTORY === 'true';
  const prefix = historical ? '/history' : '';
  return get(FLIGHTAWARE, `${prefix}/flights/${encodeURIComponent(input.ident)}/${suffix}`,
    keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'));
}

function aeroDataBoxFlight(input, env) {
  const searchBy = flightSearchTypes[input.identType];
  if (!searchBy || !/^[\da-z-]{1,10}$/i.test(input.ident ?? '')) return null;
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
  const request = get(AERODATABOX, `/flights/${searchBy}/${encodeURIComponent(input.ident)}${datePath}`,
    keyHeader(env, 'AERODATABOX_API_KEY'), {
      withLocation: multiDay ? undefined : true,
      dateLocalRole: { arrival: 'Arrival', departure: 'Departure' }[input.direction],
    });
  if (!airportClockBounds) return request;
  return {
    ...request,
    timeFilterNote: input.date
      ? 'AeroDataBox searched the selected local flight date. Its flight-number endpoint does not apply airport movement clock bounds.'
      : 'AeroDataBox searched the nearest operating date. Its flight-number endpoint does not apply airport movement clock bounds.',
  };
}

function adsbAeroHistory(input) {
  let match;
  if (input.identType === 'icao24' && asHex(input)) match = { icao24: [asHex(input)] };
  else if (input.identType === 'callsign' && /^[\da-z]{1,8}$/i.test(input.ident ?? '')) {
    match = { callsign_prefix: input.ident };
  } else if (input.identType === 'registration' && /^[\da-z-]{1,12}$/i.test(input.ident ?? '')) {
    match = { registration_prefix: input.ident };
  }
  if (!match) return null;
  const range = timeWindow(input);
  if (!range && hasTimeFilter(input)) throw new Error('Supply both start and end for an adsb.aero time range.');
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 100) : 25;
  const body = { match, limit, include_path: false };
  if (range) {
    body.end_date = new Date(range.end).toISOString();
    body.start_from = new Date(range.begin).toISOString();
    body.window_days = Math.min(7, Math.ceil((range.end - range.begin) / DAY));
  }
  if (input.cursor) body.cursor = input.cursor;
  return {
    url: new URL(`${ADSB_AERO}/query`),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
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
      live(input) {
        if (hasTimeFilter(input)) throw new Error('adsb.fi provides current positions only. Omit date and time filters.');
        const path = adsbPath(input, 'registration');
        return path ? get(ADSB_FI, `/v2${path}`) : null;
      },
    },
  },
  {
    id: 'adsb_lol',
    label: 'adsb.lol',
    docs: 'https://www.adsb.lol/docs/open-data/api',
    note: 'ODbL 1.0. This integration requires ADSB_LOL_API_KEY. Set ADSB_LOL_TIER to adhoc or feeder for the corresponding key allowance.',
    keys: ['ADSB_LOL_API_KEY'],
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
      live(input, env) {
        if (hasTimeFilter(input)) throw new Error('adsb.lol live lookups provide current positions only. Omit date and time filters.');
        const path = adsbPath(input, 'reg');
        return path ? get(ADSB_LOL, `/v2${path}`, keyHeader(env, 'ADSB_LOL_API_KEY')) : null;
      },
      track(input, env) {
        const icao = asHex(input);
        if (!icao) return null;
        if (hasTimeFilter(input)) throw new Error('This adsb.lol trace endpoint cannot filter by date or time.');
        return get(ADSB_LOL, `/1/trace/full/${icao}`, keyHeader(env, 'ADSB_LOL_API_KEY'));
      },
    },
  },
  {
    id: 'avioadsb',
    label: 'AvioADSB',
    docs: 'https://avioadsb.org/docs/api',
    note: 'CC BY-NC 4.0. Inactive contributor keys use the documented anonymous limits.',
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
      live(input, env) {
        if (hasTimeFilter(input)) throw new Error('AvioADSB provides current positions only. Omit date and time filters.');
        const path = adsbPath(input, 'reg');
        return path ? get(AVIOADSB, path, keyHeader(env, 'AVIOADSB_API_KEY')) : null;
      },
    },
  },
  {
    id: 'adsb_aero',
    label: 'adsb.aero',
    docs: 'https://adsb.aero/llms.txt',
    note: 'Public archive of observed airborne trajectories. Callsign and registration searches are prefix searches. Local spacing is 30 seconds under the provider’s fair-use guidance.',
    keys: [],
    limits: [{ requests: 1, windowMs: 30 * SECOND }],
    operations: {
      history: adsbAeroHistory,
      track(input) {
        if (input.identType !== 'provider_id' || !/^[\da-f]{6}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/i.test(input.ident ?? '')) return null;
        if (hasTimeFilter(input)) throw new Error('An adsb.aero track is selected by provider ID. Use history for a time range.');
        return get(ADSB_AERO, `/flights/${encodeURIComponent(input.ident)}`);
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
        if (hasTimeFilter(input)) throw new Error('This OpenSky lookup provides current positions only. Use history for a time range.');
        const icao24 = asHex(input);
        return icao24 ? get(OPENSKY, '/states/all', {}, { icao24 }) : null;
      },
      track: openSkyTrack,
      history(input) {
        const icao24 = asHex(input);
        const range = openSkyRange(input);
        return icao24 && range ? get(OPENSKY, '/flights/aircraft', {}, { icao24, ...range }) : null;
      },
      airport(input) {
        const direction = input.direction;
        const airport = input.airport === 'ICN' ? 'RKSI' : input.airport;
        const range = openSkyRange(input);
        if (input.ident) throw new Error('OpenSky airport movements cannot filter by flight identifier.');
        if (!/^[A-Z]{4}$/i.test(airport ?? '') || !range || !['arrival', 'departure'].includes(direction)) return null;
        return get(OPENSKY, `/flights/${direction}`, {}, { airport: airport.toUpperCase(), ...range });
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
    limits: [{ requests: 10, windowMs: MINUTE }],
    operations: {
      flight: (input, env) => flightAwareQuery(input, env, ''),
      live: (input, env) => flightAwareInstance(input, env, 'position'),
      track: (input, env) => flightAwareInstance(input, env, 'track'),
      history(input, env) {
        return flightAwareQuery(input, env, env.FLIGHTAWARE_HISTORY === 'true' ? '/history' : '', true);
      },
      airport(input, env) {
        if (!/^[A-Z0-9]{3,4}$/i.test(input.airport ?? '')) return null;
        if (input.ident) throw new Error('The AeroAPI airport movement endpoint cannot filter by flight identifier.');
        const range = timeWindow(input);
        if (!range && hasTimeFilter(input)) throw new Error('Supply both start and end for an AeroAPI airport time range.');
        const future = range && range.begin > Date.now();
        const direction = { arrival: 'arrivals', departure: 'departures' }[input.direction];
        const path = direction ? `/${future ? 'scheduled_' : ''}${direction}` : '';
        return get(FLIGHTAWARE, `/airports/${input.airport.toUpperCase()}/flights${path}`,
          keyHeader(env, 'FLIGHTAWARE_API_KEY', 'x-apikey'), {
            max_pages: 1,
            start: range ? new Date(range.begin).toISOString() : undefined,
            end: range ? new Date(range.end).toISOString() : undefined,
          });
      },
    },
  },
  {
    id: 'aerodatabox',
    label: 'AeroDataBox Direct',
    docs: 'https://doc.aerodatabox.com/direct.html',
    note: 'Direct key only. Flight status and airport boards cost 2 units, date-range flight status costs 6. Feeder credits do not reset. Airport board times use the queried airport’s local clock. Local spacing applies, with an optional confirmed monthly allowance.',
    keys: ['AERODATABOX_API_KEY'],
    limits(_input, env) {
      const units = Number(env.AERODATABOX_MONTHLY_UNITS);
      return Number.isSafeInteger(units) && units > 0
        ? [{ requests: 6, windowMs: 5 * SECOND }, { requests: units, windowMs: MONTH }]
        : [{ requests: 6, windowMs: 5 * SECOND }];
    },
    quotaCost: 6,
    operations: {
      flight: aeroDataBoxFlight,
      live: aeroDataBoxFlight,
      history(input, env) {
        return hasTimeFilter(input) ? aeroDataBoxFlight(input, env) : null;
      },
      airport(input, env) {
        if (!/^[A-Z]{3,4}$/i.test(input.airport ?? '')) return null;
        if (input.ident) throw new Error('The AeroDataBox airport board cannot filter by flight identifier.');
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
        return get(AERODATABOX, `/flights/airports/${codeType}/${code}${range}`, keyHeader(env, 'AERODATABOX_API_KEY'), {
          direction: { arrival: 'Arrival', departure: 'Departure' }[input.direction], withLeg: true, withLocation: true,
        });
      },
    },
  },
];

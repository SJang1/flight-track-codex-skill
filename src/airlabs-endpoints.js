const schema = {
  code2: { type: 'string', pattern: '^[A-Za-z]{2}$' },
  code3: { type: 'string', pattern: '^[A-Za-z]{3}$' },
  code4: { type: 'string', pattern: '^[A-Za-z]{4}$' },
  airlineIata: { type: 'string', pattern: '^[A-Za-z0-9]{2}$' },
  flightIata: { type: 'string', pattern: '^[A-Za-z0-9]{2}\\d{1,4}[A-Za-z]?$' },
  flightIcao: { type: 'string', pattern: '^[A-Za-z]{3}\\d{1,4}[A-Za-z]?$' },
  date: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  clock: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$' },
  positiveInteger: { type: 'integer', minimum: 1 },
  text: { type: 'string' },
};

function field(name, value = schema.text, description, required = false) {
  return { name, in: 'query', schema: value, ...(description ? { description } : {}), ...(required ? { required } : {}) };
}

const airportCodes = [
  field('dep_iata', schema.code3), field('dep_icao', schema.code4),
  field('arr_iata', schema.code3), field('arr_icao', schema.code4),
];
const airlineCodes = [field('airline_iata', schema.airlineIata), field('airline_icao', schema.code3)];
const flightIata = field('flight_iata', schema.flightIata);
const flightCodes = [flightIata, field('flight_icao', schema.flightIcao)];
const flightNumber = field('flight_number', { type: 'string', pattern: '^\\d{1,4}[A-Za-z]?$' }, 'Flight number without airline code.');
const selectedFields = field('_fields', schema.text, 'Comma-separated response fields.');
const offset = field('offset', { type: 'integer', minimum: 0 }, 'Pagination offset.');
const paging = (maximum) => [field('limit', { ...schema.positiveInteger, maximum }), offset];
const aircraft = [
  field('hex', { type: 'string', pattern: '^[A-Fa-f0-9]{6}$' }, 'ICAO24 address.'),
  field('reg_number', schema.text, 'Aircraft registration.'),
];
const country = field('country_code', schema.code2, 'ISO 3166-1 alpha-2 country code.');
const city = field('city_code', schema.code3, 'IATA city code.');
const flag = field('flag', schema.code2, 'ISO 3166-1 alpha-2 country code.');
const language = field('lang', schema.code2, 'Two-letter language code.');
const scheduleAirlineCodes = airlineCodes.map(({ name }) =>
  field(name, schema.text, 'Use one airline code, or narrow an airport request to several airline codes.'));
const suggestions = ['q', 'query', 's', 'search', 'text', 'term'];

function get(id, label, tag, parameters = [], options = {}) {
  return { id, label, tag, method: 'GET', path: `/${id}`, parameters, ...options };
}

function requireOne(params, fields, message) {
  if (!fields.some((name) => params[name] !== undefined)) throw new Error(message);
}

const endpoints = [
  get('ping', 'Connectivity and API-key check', 'Service'),
  get('flights', 'Live aircraft positions', 'Flights', [
    field('bbox', schema.text, 'South latitude, west longitude, north latitude, east longitude.'),
    field('zoom', { type: 'integer', minimum: 0, maximum: 11 }),
    ...aircraft, ...airlineCodes, flag, ...flightCodes, flightNumber, ...airportCodes, selectedFields,
    field('_view', { type: 'string', enum: ['object', 'array'] }),
  ]),
  get('flight', 'Single flight information', 'Flights', flightCodes, { note: 'Provide one IATA or ICAO flight identifier.' }),
  get('schedules', 'Live departures and arrivals', 'Flights', [
    ...airportCodes, ...scheduleAirlineCodes, ...flightCodes, selectedFields, ...paging(1000),
  ], { note: 'Provide an airport, airline or flight identifier. Coverage is up to ten hours ahead. Page limits depend on plan and filter.' }),
  get('historical', 'Completed flight history (beta)', 'Flights', [...flightCodes, offset], {
    baseUrl: 'https://airlabs.co/api/v10',
    formats: ['json'],
    note: 'Provide one IATA or ICAO flight identifier. The endpoint does not document date filtering.',
  }),
  get('delays', 'Delayed flights', 'Flights', [
    field('delay', { type: 'integer', minimum: 31 }, 'Minimum delay in minutes, greater than 30.', true),
    field('type', { type: 'string', enum: ['departures', 'arrivals'] }, 'Board direction.', true),
    ...airportCodes, ...airlineCodes, ...flightCodes, flightNumber, selectedFields, ...paging(500),
  ]),
  get('routes', 'Published airline routes', 'Reference', [
    ...airportCodes, ...airlineCodes, ...flightCodes, flightNumber, selectedFields, ...paging(500),
  ], { note: 'Narrow to an airport, airline, or flight when possible. The route data describes scheduled service.' }),
  get('airports', 'Airport directory', 'Reference', [field('iata_code', schema.code3), field('icao_code', schema.code4), city, country, selectedFields]),
  get('cities', 'City directory', 'Reference', [city, country, selectedFields]),
  get('airlines', 'Airline directory', 'Reference', [
    field('iata_code', schema.airlineIata), field('iata_prefix', { type: 'string', pattern: '^\\d{3}$' }),
    field('iata_accounting', { type: 'string', pattern: '^\\d{3}$' }), field('icao_code', schema.code3),
    field('callsign'), field('name'), country, selectedFields,
  ]),
  get('fleets', 'Airline fleets and aircraft registrations', 'Reference', [
    ...paging(500), ...airlineCodes, ...aircraft, field('msn'), flag, selectedFields,
  ]),
  get('countries', 'Country directory', 'Reference', [
    field('code', schema.code2), field('code3', schema.code3),
    field('continent', { type: 'string', enum: ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'] }), selectedFields,
  ]),
  get('taxes', 'Airline tax code list', 'Reference'),
  get('timezones', 'Time zone list', 'Reference'),
  get('nearby', 'Airports, cities and countries near a point', 'Search', [
    field('lat', { type: 'number', minimum: -90, maximum: 90 }, 'Latitude.', true),
    field('lng', { type: 'number', minimum: -180, maximum: 180 }, 'Longitude.', true),
    field('distance', { type: 'number', exclusiveMinimum: 0 }, 'Distance in kilometers.', true),
    language, selectedFields,
  ]),
  get('suggest', 'Search airports, cities and countries by name', 'Search', [
    ...suggestions.map((name) => field(name, { type: 'string', minLength: 3, maxLength: 30 }, 'Destination search text.')),
    language, selectedFields,
  ], { note: 'Supply the search text with one documented alias.' }),
  get('listeners', 'List existing webhook listeners', 'Flight alerts', [], { note: 'Flight Alert is a paid-plan beta.' }),
  get('webhooks', 'Webhook delivery history', 'Flight alerts', [field('days', schema.positiveInteger)], { note: 'Flight Alert is a paid-plan beta.' }),
  get('listen', 'Create a webhook listener', 'Flight alerts', [
    field('webhook_url', { type: 'string', format: 'uri' }, 'Callback URL authorized to receive flight alerts.', true),
    ...airlineCodes, flightNumber, flightIata, ...airportCodes,
    field('dep_date', schema.date), field('dep_time', schema.clock), field('arr_date', schema.date), field('arr_time', schema.clock),
    field('_fields', schema.text, 'Comma-separated watched fields.'),
  ], { mutates: true, note: 'Paid-plan beta. Registers a listener and sends notifications to an authorized callback. Deliveries count toward quota.' }),
  get('unlisten', 'Delete a webhook listener', 'Flight alerts', [
    field('listener_id', schema.positiveInteger, 'Listener ID.', true),
  ], { mutates: true, note: 'Paid-plan beta. Stops the specified listener.' }),
];

const flightKeys = flightCodes.map(({ name }) => name);
const scheduleKeys = [...airportCodes, ...airlineCodes, ...flightCodes].map(({ name }) => name);

export const airLabsNative = {
  baseUrl: 'https://airlabs.co/api/v9',
  formats: ['json', 'xml', 'csv'],
  endpoints,
  options(input, env, endpoint) {
    const params = input.nativeParams ?? {};
    const { id } = endpoint;
    if (id === 'flight' || id === 'historical') requireOne(params, flightKeys, 'Supply flight_iata or flight_icao for this AirLabs endpoint.');
    if (id === 'schedules') requireOne(params, scheduleKeys, 'Supply an airport, airline or flight filter.');
    if (id === 'suggest') requireOne(params, suggestions, 'Supply a destination search term.');
    if (id === 'flights' && params.bbox !== undefined) {
      const parts = params.bbox.split(',').map((value) => value.trim());
      const [south, west, north, east] = parts.map(Number);
      if (parts.length !== 4 || parts.some((part) => !part || !Number.isFinite(Number(part))) ||
          Math.max(Math.abs(south), Math.abs(north)) > 90 || Math.max(Math.abs(west), Math.abs(east)) > 180 || south > north) {
        throw new Error('Supply a valid AirLabs bbox as south latitude, west longitude, north latitude, east longitude.');
      }
    }
    if (id === 'listen') {
      let url;
      try { url = new URL(params.webhook_url); } catch { throw new Error('Supply an authorized HTTP(S) callback URL.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Supply an authorized HTTP(S) callback URL.');
    }
    const format = input.format ?? 'json';
    if (endpoint.formats && !endpoint.formats.includes(format)) throw new Error('The AirLabs historical beta documents JSON responses.');
    return {
      path: format === 'json' ? endpoint.path : `${endpoint.path}.${format}`,
      query: { api_key: env.AIRLABS_API_KEY.trim() },
    };
  },
};

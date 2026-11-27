// Native HTTP operations from the providers' public documentation.
const text = { type: 'string' };
const boolean = { type: 'boolean' };
const integer = { type: 'integer' };
const number = { type: 'number' };
const latitude = { ...number, minimum: -90, maximum: 90 };
const longitude = { ...number, minimum: -180, maximum: 180 };
const hex = { ...text, pattern: '^[0-9A-Fa-f]{6}$' };
const batchHex = { ...text, pattern: '^[0-9A-Fa-f]{6}(,[0-9A-Fa-f]{6}){0,19}$' };
const callsign = { ...text, pattern: '^[A-Za-z0-9]{1,8}$' };
const registration = { ...text, pattern: '^[A-Za-z0-9-]{1,12}$' };
const squawk = { ...text, pattern: '^[0-7]{4}$' };
const aircraftType = { ...text, pattern: '^[A-Za-z0-9]{2,4}$' };
const icaoAirport = { ...text, pattern: '^[A-Za-z]{4}$' };
const aircraftId = { ...text, pattern: '^[0-9A-Fa-f]{6}:\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$' };
const utcDate = { ...text, format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const utcTime = { ...text, format: 'date-time' };
const DAY_SECONDS = 86400;

const path = (name, schema) => ({ name, in: 'path', required: true, schema });
const query = (name, schema, required = false) => ({ name, in: 'query', required, schema });
const get = (id, label, path, parameters = [], options = {}) => ({ id, label, method: 'GET', path, parameters, ...options });
const range = (schema, minimum, maximum) => ({ ...schema, minimum, maximum });
const choices = (...values) => ({ ...text, enum: values });
const position = (radius) => [path('lat', latitude), path('lon', longitude), path('radius', radius)];
const keyHeader = (env, key) => env[key]?.trim() ? { 'X-API-Key': env[key].trim() } : {};

// https://github.com/adsbfi/opendata#public-endpoints
export const adsbFiNative = {
  baseUrl: 'https://opendata.adsb.fi/api',
  endpoints: [
    get('hex', 'Aircraft by Mode S address', '/v2/hex/{hex}', [path('hex', hex)]),
    get('icao', 'Aircraft by one or more ICAO24 addresses', '/v2/icao/{hex}', [path('hex', { ...text, pattern: '^[0-9A-Fa-f]{6}(,[0-9A-Fa-f]{6})*$' })]),
    get('callsign', 'Aircraft by callsign', '/v2/callsign/{callsign}', [path('callsign', callsign)]),
    get('registration', 'Aircraft by registration', '/v2/registration/{reg}', [path('reg', registration)]),
    get('squawk', 'Aircraft by squawk', '/v2/sqk/{squawk}', [path('squawk', squawk)]),
    get('military', 'Aircraft classified as military', '/v2/mil'),
    get('nearby', 'Aircraft within the radius', '/v3/lat/{lat}/lon/{lon}/dist/{dist}', [path('lat', latitude), path('lon', longitude), path('dist', { ...number, exclusiveMinimum: 0, maximum: 250 })]),
  ],
};

const lolRadius = range(integer, 0, 250);
const lolRouteBody = {
  type: 'object', additionalProperties: false,
  properties: {
    planes: { type: ['array', 'null'], items: {
      type: 'object', additionalProperties: false, required: ['callsign', 'lat', 'lng'],
      properties: { callsign, lat: latitude, lng: longitude },
    } },
  },
};

// https://api.adsb.lol/api/openapi.json
export const adsbLolNative = {
  baseUrl: 'https://api.adsb.lol',
  endpoints: [
    get('pia', 'Aircraft with Privacy ICAO Addresses', '/v2/pia'),
    get('military', 'Aircraft classified as military', '/v2/mil'),
    get('ladd', 'Aircraft in the LADD program', '/v2/ladd'),
    get('sqk', 'Aircraft by squawk', '/v2/sqk/{squawk}', [path('squawk', squawk)]),
    get('squawk', 'Aircraft by squawk', '/v2/squawk/{squawk}', [path('squawk', squawk)]),
    get('type', 'Aircraft by type designator', '/v2/type/{aircraft_type}', [path('aircraft_type', aircraftType)]),
    get('reg', 'Aircraft by registration', '/v2/reg/{registration}', [path('registration', registration)]),
    get('registration', 'Aircraft by registration', '/v2/registration/{registration}', [path('registration', registration)]),
    get('icao', 'Aircraft by ICAO24 address', '/v2/icao/{icao_hex}', [path('icao_hex', hex)]),
    get('hex', 'Aircraft by ICAO24 address', '/v2/hex/{icao_hex}', [path('icao_hex', hex)]),
    get('callsign', 'Aircraft by callsign', '/v2/callsign/{callsign}', [path('callsign', callsign)]),
    get('radius', 'Aircraft within the radius', '/v2/lat/{lat}/lon/{lon}/dist/{radius}', position(lolRadius)),
    get('point', 'Aircraft within the radius', '/v2/point/{lat}/{lon}/{radius}', position(lolRadius)),
    get('closest', 'Nearest aircraft within the radius', '/v2/closest/{lat}/{lon}/{radius}', position(lolRadius)),
    get('airport', 'Airport by ICAO code', '/api/0/airport/{icao}', [path('icao', icaoAirport)]),
    { id: 'routeset', label: 'Look up routes for observed callsigns', method: 'POST', path: '/api/0/routeset', parameters: [], body: lolRouteBody, bodyRequired: true, changesAccount: false, note: 'The aircraft positions disambiguate reused callsigns.' },
    get('receiver_stats', 'Receiver information and network statistics', '/0/me', [], { note: 'Receiver information reflects the IP address making the request.' }),
    get('map_redirect', 'Receiver map redirect', '/0/my', [], { reportRedirect: true, note: 'The redirect is based on the IP address making the request.' }),
    get('trace_full', 'Full stored aircraft trace', '/1/trace/full/{icao_hex}', [path('icao_hex', hex)]),
    get('trace_recent', 'Recent stored aircraft trace', '/1/trace/recent/{icao_hex}', [path('icao_hex', hex)]),
  ],
  options(_input, env) { return { headers: keyHeader(env, 'ADSB_LOL_API_KEY') }; },
};

const avioRadius = { ...number, exclusiveMinimum: 0, maximum: 250 };
const avioLinks = { ...text, pattern: '^(acars|vdl2|hfdl|satcom)(,(acars|vdl2|hfdl|satcom)){0,3}$' };
const avioDatalink = [
  query('hex', hex), query('type', avioLinks), query('link', avioLinks),
  query('network', choices('inmarsat', 'iridium')), query('limit', range(integer, 1, 500)),
];

function validBox(minLat, minLon, maxLat, maxLon) {
  return minLat >= -90 && minLon >= -180 && maxLat <= 90 && maxLon <= 180 && minLat < maxLat && minLon < maxLon;
}

// https://avioadsb.org/v1/openapi.json
export const avioAdsbNative = {
  baseUrl: 'https://avioadsb.org/v1',
  endpoints: [
    get('hex', 'Aircraft by ICAO24 address', '/hex/{icao}', [path('icao', batchHex)]),
    get('extended', 'Extended aircraft observation', '/extended/{icao}', [path('icao', batchHex)]),
    get('icao', 'Aircraft by ICAO24 address', '/icao/{icao}', [path('icao', batchHex)]),
    get('callsign', 'Aircraft by callsign', '/callsign/{callsign}', [path('callsign', callsign)]),
    get('registration', 'Aircraft by registration', '/reg/{registration}', [path('registration', registration)]),
    get('type', 'Aircraft by type designator', '/type/{aircraft_type}', [path('aircraft_type', aircraftType)]),
    get('squawk', 'Aircraft by squawk', '/squawk/{squawk}', [path('squawk', squawk)]),
    get('military', 'Aircraft classified as military', '/mil'),
    get('point', 'Aircraft within the radius', '/point/{lat}/{lon}/{radius}', position(avioRadius)),
    get('closest', 'Nearest aircraft within the radius', '/closest/{lat}/{lon}/{radius}', position(avioRadius)),
    get('aircraft', 'Contributing receiver network aircraft', '/aircraft', [query('bbox', {
      ...text, pattern: '^-?\\d+(\\.\\d+)?(,-?\\d+(\\.\\d+)?){3}$', description: 'minLat,minLon,maxLat,maxLon',
    })], { keys: ['AVIOADSB_API_KEY'], note: 'An active contributor key is required. Use bbox to limit results.' }),
    get('acars', 'Recent datalink messages', '/acars', [
      ...avioDatalink, query('adsc', boolean), query('tail', { ...registration, minLength: 2 }),
      query('flight', { ...text, pattern: '^[A-Za-z0-9]{2,8}$' }), query('label', { ...text, minLength: 1, maxLength: 2 }),
      query('q', { ...text, minLength: 3, maxLength: 64 }), query('after', { ...integer, minimum: 0 }),
    ]),
    get('adsc', 'Most recent ADS-C reports', '/adsc', avioDatalink, { note: 'ADS-C positions are aircraft reports. Check the report timestamp.' }),
    get('stats', 'Network statistics', '/stats'),
    get('me', 'Rate tier and remaining quota', '/me', [], { note: 'This endpoint does not consume quota.' }),
  ],
  options({ nativeParams: params = {} }, env) {
    const headers = keyHeader(env, 'AVIOADSB_API_KEY');
    if (!headers['X-API-Key'] && (params.radius > 100 || params.limit > 50)) throw new Error('Anonymous AvioADSB requests allow at most 100 nautical miles or 50 datalink records.');
    if (params.bbox && !validBox(...params.bbox.split(',').map(Number))) throw new Error('Supply an ordered bounding box in latitude and longitude.');
    if (params.type && params.link) {
      const types = new Set(params.type.split(','));
      const links = new Set(params.link.split(','));
      if (types.size !== links.size || [...types].some((type) => !links.has(type))) throw new Error('AvioADSB type and link must select the same protocols.');
    }
    return { headers };
  },
};

const aeroQueryBody = {
  type: 'object', additionalProperties: false,
  properties: {
    end_date: { ...utcTime, type: ['string', 'null'] }, start_from: { ...utcTime, type: ['string', 'null'] },
    window_days: range(integer, 1, 7),
    match: { type: ['object', 'null'], additionalProperties: true, description: 'One documented adsb.aero predicate. See the provider guide for geometry, trajectory, endpoint and boolean expressions.' },
    limit: range(integer, 1, 10000), cursor: { type: ['string', 'null'] }, include_path: boolean,
  },
};

// https://adsb.aero/api/openapi.json
export const adsbAeroNative = {
  baseUrl: 'https://adsb.aero/api/v1',
  endpoints: [
    get('health', 'API availability', '/health'),
    get('data_range', 'Available archive dates', '/data-range'),
    get('icao_types', 'Aircraft type counts by date range', '/icao-types', [query('start', utcDate, true), query('end', utcDate, true)]),
    { id: 'query_flights', label: 'Search archived trajectories', method: 'POST', path: '/query', parameters: [], body: aeroQueryBody, bodyRequired: true, changesAccount: false,
      note: 'Use a modest limit. Disable include_path when searching for records rather than trajectories.' },
    get('flight', 'Full trajectory by archive flight ID', '/flights/{flight_id}', [path('flight_id', aircraftId)]),
    get('waypoint_search', 'Search airports, navaids and reporting points', '/waypoints/search', [
      query('q', { ...text, minLength: 1, maxLength: 100 }, true),
      query('kinds', { ...text, pattern: '^(airport|navaid|reporting_point)(,(airport|navaid|reporting_point))*$' }), query('limit', range(integer, 1, 20)),
    ]),
    get('waypoint', 'Waypoint by OpenAIP ID', '/waypoints/{waypoint_id}', [path('waypoint_id', text)]),
    get('airport', 'Airport and its aerodrome airspace', '/airports/{code}', [path('code', { ...text, minLength: 2, maxLength: 8 })]),
    get('airspaces', 'Airspaces near a point', '/airspaces', [query('pos', {
      ...text, pattern: '^[+-]?\\d+(\\.\\d+)?,[+-]?\\d+(\\.\\d+)?$', description: 'Latitude,longitude in decimal degrees.',
    }, true), query('dist', range(number, 0, 100))]),
  ],
  options({ nativeParams: params = {}, nativeBody: body }) {
    if (params.start && params.start > params.end) throw new Error('The adsb.aero statistics end date must not precede the start date.');
    if (body?.start_from && body.end_date && Date.parse(body.start_from) >= Date.parse(body.end_date)) throw new Error('The adsb.aero query end date must follow start_from.');
    if (params.pos) {
      const [lat, lon] = params.pos.split(',').map(Number);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Supply coordinates in degrees WGS84.');
    }
    return {};
  },
};

const skyStates = [{ ...query('icao24', { type: 'array', items: hex, minItems: 1 }), explode: true }, query('time', { ...integer, minimum: 0 })];
const skyRange = [query('begin', { ...integer, minimum: 0 }, true), query('end', { ...integer, minimum: 0 }, true)];
const skyExtended = query('extended', { ...integer, enum: [0, 1] });

// https://openskynetwork.github.io/opensky-api/rest.html
export const openSkyNative = {
  baseUrl: 'https://opensky-network.org/api',
  endpoints: [
    get('states_all', 'Network state vectors', '/states/all', [
      ...skyStates, query('lamin', latitude), query('lomin', longitude), query('lamax', latitude), query('lomax', longitude),
      skyExtended,
    ], { note: 'Current states work anonymously. Use OAuth for a historical time parameter.' }),
    get('states_own', 'State vectors from your own receivers', '/states/own', [
      ...skyStates, { ...query('serials', { type: 'array', items: integer, minItems: 1 }), explode: true }, skyExtended,
    ], { note: 'Requires access to the designated receivers. This endpoint does not consume credits.' }),
    get('flights_all', 'Network flights in an archive time range', '/flights/all', skyRange, { note: 'The range is limited to two hours. Inputs are Unix seconds.' }),
    get('flights_aircraft', 'Archived flights by aircraft', '/flights/aircraft', [query('icao24', hex, true), ...skyRange]),
    get('flights_arrival', 'Archived airport arrivals', '/flights/arrival', [query('airport', icaoAirport, true), ...skyRange]),
    get('flights_departure', 'Archived airport departures', '/flights/departure', [query('airport', icaoAirport, true), ...skyRange]),
    get('track', 'Aircraft track', '/tracks/all', [query('icao24', hex, true), query('time', { ...integer, minimum: 0 }, true)], { note: 'Use time 0 for live. The REST example and official SDK both use /tracks/all.' }),
  ],
  options({ nativeEndpoint: endpoint, nativeParams: params = {} }) {
    if (endpoint === 'states_all') {
      const bounds = [params.lamin, params.lomin, params.lamax, params.lomax];
      if (bounds.some((value) => value !== undefined) && !validBox(...bounds)) throw new Error('Supply all four ordered WGS84 bounding-box coordinates.');
    }
    if (params.begin !== undefined) {
      const seconds = params.end - params.begin;
      if (seconds <= 0 || seconds > (endpoint === 'flights_all' ? 7200 : 2 * DAY_SECONDS)) throw new Error('Supply an ordered OpenSky flight interval within the endpoint’s maximum duration.');
      if (['flights_arrival', 'flights_departure'].includes(endpoint) && Math.floor(params.end / DAY_SECONDS) - Math.floor(params.begin / DAY_SECONDS) > 1) {
        throw new Error('OpenSky arrival and departure searches can cross at most one UTC midnight.');
      }
    }
    if (params.time && endpoint !== 'states_own') {
      const age = Math.floor(Date.now() / 1000) - params.time;
      if (age < 0 || age > (endpoint === 'track' ? 30 * DAY_SECONDS : 3600)) throw new Error('Supply an OpenSky timestamp within the endpoint’s recent history window.');
    }
    const address = params.icao24;
    return { query: {
      ...(address ? { icao24: Array.isArray(address) ? address.map((value) => value.toLowerCase()) : address.toLowerCase() } : {}),
      ...(params.airport ? { airport: params.airport.toUpperCase() } : {}),
    } };
  },
};

// https://freeairportdb.com/api
export const freeAirportDbNative = {
  baseUrl: 'https://api.freeairportdb.com/v1',
  endpoints: [
    get('search', 'Search airports', '/airports', [
      query('q', text), query('type', choices('all', 'large_airport', 'medium_airport', 'small_airport')),
      query('country', { ...text, pattern: '^[A-Za-z]{2}$' }), query('limit', range(integer, 1, 100)), query('offset', { ...integer, minimum: 0 }),
    ]),
    get('airport', 'Airport by IATA, ICAO or OurAirports code', '/airports/{code}', [path('code', { ...text, pattern: '^[A-Za-z0-9-]+$' })]),
    get('nearby', 'Nearby airports', '/airports/nearby', [
      query('lat', latitude, true), query('lng', longitude, true), query('limit', range(integer, 1, 50)), query('radius', { ...number, minimum: 0 }),
    ]),
  ],
};

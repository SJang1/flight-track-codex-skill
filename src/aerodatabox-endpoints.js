// AeroDataBox Direct OpenAPI 1.15.4.0
// https://doc.aerodatabox.com/docs/openapi-direct-v1.json

const date = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Calendar date (YYYY-MM-DD).' };
const minute = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d$', placeholder: 'YYYY-MM-DDTHH:mm', description: 'Local time at minute precision (YYYY-MM-DDTHH:mm), without an offset.' };
const int32 = { type: 'integer', minimum: -2147483648, maximum: 2147483647 };
const boolean = { type: 'boolean' };
const direction = { type: 'string', enum: ['Arrival', 'Departure', 'Both'] };
const airportCode = { type: 'string', minLength: 3, maxLength: 4, description: 'Airport code matching codeType.' };
const aircraftSearch = { type: 'string', enum: ['Id', 'Reg', 'Icao24'], description: 'Aircraft ID, tail number, or Mode S address.' };
const flightSearch = { type: 'string', enum: ['Number', 'Reg', 'CallSign', 'Icao24'], description: 'Flight number, tail number, ATC callsign, or Mode S address.' };

const parameters = {
  searchBy: flightSearch,
  searchParam: { type: 'string', maxLength: 10, description: 'Identifier matching searchBy.' },
  withImage: { ...boolean, default: false },
  withRegistrations: { ...boolean, default: false },
  airlineCode: { type: 'string', minLength: 2, maxLength: 3, description: 'Airline IATA or ICAO code.' },
  pageSize: { ...int32, minimum: 1, description: 'Page size. The upper limit depends on the account plan.' },
  pageOffset: { ...int32, minimum: 0, default: 0, description: 'Zero-based record offset.' },
  reg: { type: 'string', description: 'Aircraft registration.' },
  q: { type: 'string', description: 'Search term.' },
  limit: { ...int32, minimum: 1 },
  codeType: { type: 'string', enum: ['Icao', 'Iata'] },
  code: airportCode,
  codeFrom: airportCode,
  codeTo: airportCode,
  withRunways: { ...boolean, default: false },
  withTime: { ...boolean, default: false },
  lat: { type: 'number', minimum: -90, maximum: 90 },
  lon: { type: 'number', minimum: -180, maximum: 180 },
  radiusKm: { ...int32, minimum: 1, maximum: 1000 },
  withFlightInfoOnly: { ...boolean, default: false },
  withSearchByCode: { ...boolean, default: true },
  subjectType: { type: 'string', enum: ['FlightByNumber', 'FlightByAirportIcao'] },
  subjectId: { type: 'string', description: 'Flight number or four-letter ICAO airport code, according to subjectType.' },
  subscriptionId: { type: 'string', format: 'uuid' },
  dateLocal: date,
  dateFromLocal: date,
  dateToLocal: date,
  fromLocal: date,
  toLocal: date,
  dateUtc: { ...minute, description: 'UTC time at minute precision (YYYY-MM-DDTHH:mm), without a suffix.' },
  dateLocalRole: { ...direction, description: 'Select the departure date, arrival date, or both.' },
  direction,
  withAircraftImage: { ...boolean, default: false },
  withLocation: { ...boolean, default: false },
  withFlightPlan: { ...boolean, default: false, description: 'Include the filed ATC plan. Coverage, access and possible extra charges depend on the plan.' },
  withLeg: { ...boolean, default: false },
  withCancelled: { ...boolean, default: true },
  withCodeshared: { ...boolean, default: true },
  withCargo: { ...boolean, default: true },
  withPrivate: { ...boolean, default: true },
  offsetMinutes: { type: 'integer', default: -120, description: 'Start relative to the present, in minutes. Negative values start in the past.' },
  durationMinutes: { type: 'integer', minimum: 1, default: 720, description: 'Board duration in minutes. The upper limit depends on the account plan.' },
  service: { type: 'string', enum: ['FlightSchedules', 'FlightLiveUpdates', 'AdsbUpdates'] },
  withHttpCode: { ...boolean, default: false, description: 'Reflect feed health in the HTTP status.' },
  icao: { type: 'string', pattern: '^[A-Za-z]{4}$', description: 'Four-letter ICAO airport code.' },
  id: { type: 'string', minLength: 2, maxLength: 15, description: 'Callsign or aircraft registration.' },
  aircraftName: { type: 'string', description: 'Aircraft name, model, or type as documented by AeroDataBox.' },
  flightTimeModel: { type: 'string', enum: ['Standard', 'ML01'] },
  number: { type: 'string', maxLength: 8, description: 'IATA or ICAO flight number.' },
};

const webhookBody = {
  type: 'object', additionalProperties: false, required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', minLength: 1, description: 'Public HTTP(S) callback URL. Its owner must consent to receiving notifications.' },
    maxDeliveryRetries: { type: ['integer', 'null'], minimum: 0, maximum: 2, description: 'Maximum callback delivery retries.' },
  },
};
const refillBody = {
  type: 'object', additionalProperties: false, required: ['credits'],
  properties: { credits: { ...int32, minimum: 1, description: 'Flight-alert credits to add by spending API units.' } },
};

const flight = '/flights/{searchBy}/{searchParam}';
const aircraft = '/aircrafts/{searchBy}/{searchParam}';
const airport = '/airports/{codeType}/{code}';
const board = '/flights/airports/{codeType}/{code}';
const subscription = '/subscriptions/webhook/{subscriptionId}';
const optionalFlight = 'dateLocalRole withAircraftImage withLocation withFlightPlan';
const optionalBoard = 'direction withLeg withCancelled withCodeshared withCargo withPrivate withLocation';
const airportSearchLimit = { ...parameters.limit, maximum: 250 };
const service = '/health/services/feeds/{service}';

// Rows use the upstream operationId. Path placeholders are always required.
// The field list uses * for additional required query parameters.
const groups = {
  Aircraft: [
    ['GetAircraft', 'Aircraft detail', aircraft, 1, 'withImage withRegistrations', { searchBy: aircraftSearch }],
    ['GetAircraftRegistrations', 'Aircraft registration history', `${aircraft}/registrations`, 1, '', { searchBy: aircraftSearch }],
    ['GetAllAircraft', 'All matching aircraft', `${aircraft}/all`, 1, 'withImage withRegistrations', { searchBy: aircraftSearch }],
    ['GetAirlineFleet', 'Airline fleet (beta)', '/airlines/{airlineCode}/aircrafts', 3, '*pageSize pageOffset withRegistrations'],
    ['GetAircraftImageByRegistration', 'Aircraft image (beta)', '/aircrafts/reg/{reg}/image/beta', 2],
    ['SearchAircraftByTerm', 'Search active aircraft registrations', '/aircrafts/search/term', 2, '*q limit', { q: { ...parameters.q, minLength: 4 }, limit: { ...parameters.limit, maximum: 10, default: 5 } }],
  ],
  Airport: [
    ['GetAirport', 'Airport detail', airport, 1, 'withRunways withTime'],
    ['GetAirportRunways', 'Airport runways', `${airport}/runways`, 1],
    ['SearchAirportsByLocation', 'Search airports by coordinates', '/airports/search/location', 2, '*lat *lon *radiusKm *limit withFlightInfoOnly', { limit: airportSearchLimit }],
    ['SearchAirportsByIpGeoLocation', 'Search airports by IP geolocation', '/airports/search/ip', 2, '*q *radiusKm *limit withFlightInfoOnly', { q: { type: 'string', format: 'ipv4', description: 'Public IPv4 address.' }, limit: airportSearchLimit }],
    ['SearchAirportByTerm', 'Search airports by name or code', '/airports/search/term', 2, '*q limit withFlightInfoOnly withSearchByCode', { q: { ...parameters.q, minLength: 3 }, limit: { ...airportSearchLimit, default: 10 } }],
  ],
  'Flight alerts': [
    ['SubscribeWebhook', 'Create a webhook subscription', '/subscriptions/webhook/{subjectType}/{subjectId}', 0, '', {}, 'POST', webhookBody],
    ['GetWebhook', 'Inspect a webhook subscription', subscription, 0],
    ['UnsubscribeWebhook', 'Remove a webhook subscription', subscription, 0, '', {}, 'DELETE'],
    ['GetWebhookList', 'List webhook subscriptions', '/subscriptions/webhook', 0],
    ['GetBalance', 'Flight-alert credit balance', '/subscriptions/balance', 0],
    ['RefillBalance', 'Refill flight-alert credits', '/subscriptions/balance/refill', 1, '', {}, 'POST', refillBody],
  ],
  Flight: [
    ['GetFlight_FlightNearest', 'Flight status on the nearest operating day', flight, 2, optionalFlight],
    ['GetFlight_FlightOnSpecificDate', 'Flight status on a specified date', `${flight}/{dateLocal}`, 2, optionalFlight],
    ['GetFlightHistory_FlightHistory', 'Flight history or schedule across dates', `${flight}/{dateFromLocal}/{dateToLocal}`, 3, 'dateLocalRole'],
    ['GetFlightDates_FlightDatesAll', 'All flight departure dates', `${flight}/dates`, 2],
    ['GetFlightDates_FlightDatesInRange', 'Flight departure dates in a range', `${flight}/dates/{fromLocal}/{toLocal}`, 2],
    ['GetAirportFlights', 'Airport board for local clock times', `${board}/{fromLocal}/{toLocal}`, 2, optionalBoard, { fromLocal: minute, toLocal: minute }],
    ['GetAirportFlightsRelative', 'Airport board relative to the present', board, 2, `offsetMinutes durationMinutes ${optionalBoard}`],
    ['SearchFlightsByTerm', 'Search flight numbers', '/flights/search/term', 2, '*q limit', { q: { ...parameters.q, minLength: 2 }, limit: { ...parameters.limit, maximum: 100, default: 10 } }],
  ],
  'Feed health': [
    ['GetFeedServiceStatus', 'Feed service health', service, 0, 'withHttpCode'],
    ['GetAirportFeedStatus', 'Feed health at an airport', '/health/services/airports/{icao}/feeds', 0],
    ['GetFeedAirports', 'Airports covered by a feed', `${service}/airports`, 0],
  ],
  Industry: [
    ['GetFaaLaddAircraftStatus', 'FAA LADD aircraft status', '/industry/faa-ladd/{id}/status', 3],
  ],
  'Times and distances': [
    ['GetAirportLocalTime', 'Current airport local time', `${airport}/time/local`, 1],
    ['GetAirportSolarTime_SolarTimeCurrent', 'Current airport solar and daylight times', `${airport}/time/solar`, 1],
    ['GetAirportSolarTime_SolarTimeSpecificDate', 'Airport solar and daylight times at a local time', `${airport}/time/solar/{dateLocal}`, 1, '', { dateLocal: minute }],
    ['GetAirportDistanceTime', 'Distance and estimated flight time', '/airports/{codeType}/{codeFrom}/distance-time/{codeTo}', 2, 'aircraftName flightTimeModel'],
  ],
  Statistics: [
    ['GetAirportDelay_DelaysCurrent', 'Current airport delays', `${airport}/delays`, 3],
    ['GetAirportDelay_DelaysHistorical', 'Airport delays at a historical local time', `${airport}/delays/{dateLocal}`, 3, '', { dateLocal: minute }],
    ['GetAirportDelays', 'Airport delays across a historical period', `${airport}/delays/{dateFromLocal}/{dateToLocal}`, 3, '', { dateFromLocal: minute, dateToLocal: minute }],
    ['GetRouteDailyStatistics_RoutesDailyCurrent', 'Current daily routes and destinations', `${airport}/stats/routes/daily`, 3],
    ['GetRouteDailyStatistics_RoutesDailAtSpecificDate', 'Daily routes and destinations on a date', `${airport}/stats/routes/daily/{dateLocal}`, 3],
    ['GetGlobalDelays_GlobalDelaysCurent', 'Current global delays', '/airports/delays', 3],
    ['GetGlobalDelays_GlobalDelaysAtSpecificDate', 'Global delays at a historical UTC time', '/airports/delays/{dateUtc}', 3],
    ['GetFlightDelays', 'Flight-number delay statistics', '/flights/{number}/delays', 3],
  ],
};

const unitsByTier = [0, 1, 2, 6];
const endpoints = Object.entries(groups).flatMap(([tag, rows]) => rows.map((row) => {
  const [id, label, path, tier, queryFields = '', overrides = {}, method = 'GET', body] = row;
  const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  const query = queryFields ? queryFields.split(' ') : [];
  const params = [...pathParams, ...query.map((name) => name.replace(/^\*/, ''))];
  const required = [...pathParams, ...query.filter((name) => name.startsWith('*')).map((name) => name.slice(1))];
  return {
    id, label, tag, method, path, tier: tier || 'free',
    base_units: id === 'RefillBalance' ? null : unitsByTier[tier],
    params, required, path_params: pathParams,
    parameters: Object.fromEntries(params.map((name) => [name, overrides[name] ?? parameters[name]])),
    ...(body ? { body } : {}),
  };
}));

const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
export const aeroDataBoxEndpoint = (id) => byId.get(id);
export const aeroDataBoxReadIds = endpoints.filter(({ method }) => method === 'GET').map(({ id }) => id);
export const aeroDataBoxWriteIds = endpoints.filter(({ method }) => method !== 'GET').map(({ id }) => id);
export const aeroDataBoxEndpointCatalog = () => ({ aerodatabox_endpoints: endpoints });
export const aeroDataBoxExplorerCatalog = { endpoints, parameters };

export const aeroDataBoxParamProperties = {
  ...parameters,
  searchBy: { ...flightSearch, enum: [...new Set([...flightSearch.enum, ...aircraftSearch.enum])] },
  dateLocal: { type: 'string', description: 'Endpoint-specific date or local timestamp. See aviation_providers.' },
  dateFromLocal: { type: 'string' },
  dateToLocal: { type: 'string' },
  fromLocal: { type: 'string' },
  toLocal: { type: 'string' },
};

export const aeroDataBoxBodyProperties = { ...webhookBody.properties, ...refillBody.properties };

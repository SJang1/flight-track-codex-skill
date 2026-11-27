// Official Aviationstack OpenAPI 1.0.1:
// https://api.swaggerhub.com/apis/apilayer-863/AviationstackAPI/1.0.1/swagger.json

const string = { type: 'string' };
const date = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const dateTime = { type: 'string', format: 'date-time' };
const nonnegative = { type: 'integer', minimum: 0 };

function query(name, schema = string, description, required = false) {
  return { name, in: 'query', schema, ...(description ? { description } : {}), ...(required ? { required } : {}) };
}

const status = ['scheduled', 'active', 'landed', 'cancelled', 'incident', 'diverted'];
const airports = [
  query('dep_iata', string, 'Departure airport or city IATA code.'), query('arr_iata', string, 'Arrival airport or city IATA code.'),
  query('dep_icao', string, 'Departure airport ICAO code.'), query('arr_icao', string, 'Arrival airport ICAO code.'),
];
const airlines = [query('airline_iata'), query('airline_icao')];
const airlineName = query('airline_name');
const flightCodes = [query('flight_iata'), query('flight_icao')];
const flightNumber = query('flight_number', string, 'Flight number without airline code.');
const callback = query('callback', string, 'Optional JSONP callback name. The response is returned as text.');
const offset = query('offset', { ...nonnegative, default: 0 });
const limit = { type: 'integer', minimum: 1, maximum: 1000, default: 100 };
const planPaging = [query('limit', limit, 'Maximum 100 below Professional, 1000 on Professional or higher.'), offset];
const referencePaging = [query('limit', limit), offset];
const airportBoard = [
  query('iataCode', { type: 'string', pattern: '^[A-Za-z]{3}$' }, 'IATA code of the airport.', true),
  query('type', { type: 'string', enum: ['departure', 'arrival'] }, 'Airport board direction.', true),
];
const boardSide = (side) => [
  query(`${side}_terminal`), query(`${side}_delay`, nonnegative, 'Delay in minutes.'),
  query(`${side}_schTime`, dateTime, 'Scheduled time.'), query(`${side}_estTime`, dateTime, 'Estimated time.'),
  query(`${side}_actTime`, dateTime, 'Actual time.'), query(`${side}_estRunway`, dateTime, 'Estimated runway time.'),
  query(`${side}_actRunway`, dateTime, 'Actual runway time.'),
];

function get(id, label, tag, parameters, note) {
  return { id, label, tag, method: 'GET', path: `/${id}`, parameters, ...(note ? { note } : {}) };
}

const reference = [
  ['airports', 'Airport catalog'], ['airlines', 'Airline catalog'], ['airplanes', 'Aircraft and registrations catalog'],
  ['aircraft_types', 'Aircraft types catalog'], ['cities', 'City catalog'], ['countries', 'Country catalog'],
  ['taxes', 'Aviation taxes catalog'],
];

export const AVIATIONSTACK_BASE_URL = 'https://api.apilayer.net/aviationstack/v1';

export const aviationstackNative = {
  baseUrl: AVIATIONSTACK_BASE_URL,
  endpoints: [
    get('flights', 'Real-time and historical flights', 'Flights', [
      ...planPaging, callback, query('flight_status', { type: 'string', enum: status }), query('flight_date', date),
      ...airports, airlineName, ...airlines, flightNumber, ...flightCodes,
      query('min_delay_dep', nonnegative), query('min_delay_arr', nonnegative),
      query('max_delay_dep', nonnegative), query('max_delay_arr', nonnegative),
      query('arr_scheduled_time_arr', date), query('dep_scheduled_time_dep', date),
    ], 'Historical flight data requires Basic or higher. Live position data is included when available.'),
    get('timetable', 'Today’s departures or arrivals', 'Flights', [
      ...airportBoard, ...planPaging,
      query('status', { type: 'string', enum: [...status, 'redirected', 'unknown'] }),
      airlineName, ...airlines, ...flightCodes, query('flight_num'), ...boardSide('dep'), ...boardSide('arr'), callback,
    ], 'Current airport-local board. Availability and response limits depend on your plan.'),
    get('flightsFuture', 'Future airport departures or arrivals', 'Flights', [
      ...airportBoard, query('date', date, 'An operating date from tomorrow through 365 days ahead.', true),
      ...airlines, flightNumber, ...planPaging, callback,
    ], 'The future board requires Basic or higher.'),
    get('routes', 'Published airline routes', 'Reference', [
      ...referencePaging, callback, flightNumber, ...airports, ...airlines,
    ], 'Airline routes require Basic or higher.'),
    ...reference.map(([id, label]) => get(id, label, 'Reference', [
      ...referencePaging, callback, query('search', string, 'Keyword autocomplete requires Basic or higher.'),
    ])),
  ],
  options(_input, env) {
    return { query: { access_key: env.AVIATIONSTACK_API_KEY.trim() } };
  },
};

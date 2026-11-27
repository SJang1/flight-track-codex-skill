import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

// AirNav On Demand OpenAPI 2.4.22.
const airNavOperations = `
getAircraft GET /aircraft
searchAircraft GET /aircraft/search
searchAirport GET /airports/search
getAirport GET /airports/{icaoCode}
getDatis GET /airports/{icaoCode}/datis
getMetar GET /airports/{icaoCode}/metar
getTaf GET /airports/{icaoCode}/taf
getNatTracks GET /airspace/natTracks
getPacTracks GET /airspace/pacTracks
getNotams GET /airspace/{icaoCode}/notams
status GET /billing/status
usage GET /billing/usage
geosearch POST /flights/geosearch
aircraftPosition POST /flights/live
getScheduledFlights GET /flights/schedules
search POST /flights/search
getAirlineStatistics GET /statistics/airline/{icaoCode}
getAirlinesStatistics GET /statistics/airlines
getMajorAirportStatistics GET /statistics/airports
getBusinessAirportStatistics GET /statistics/airports/business
getCommercialAirportStatistics GET /statistics/airports/commercial
getFlightsStatistics GET /statistics/flights
getBusinessFlightsStatistics GET /statistics/flights/business
getBusJetModelsStatisticsInternal GET /statistics/flights/business/models
getBusJetOperatorStatisticsInternal GET /statistics/flights/business/operators
getCommercialFlightsStatistics GET /statistics/flights/commercial
`;

// FlightAware AeroAPI portal OpenAPI 4.30.0.
const flightAwareOperations = `
get_flights_by_search GET /flights/search
get_flights_by_position_search GET /flights/search/positions
get_flights_count_by_search GET /flights/search/count
get_flights_by_advanced_search GET /flights/search/advanced
get_flight GET /flights/{ident}
get_flights_canonical GET /flights/{ident}/canonical
post_flights_by_ident POST /flights/{ident}/intents
get_flight_position GET /flights/{id}/position
get_flight_track GET /flights/{id}/track
get_flight_route GET /flights/{id}/route
get_flight_map GET /flights/{id}/map
get_flight_with_foresight GET /foresight/flights/{ident}
get_flights_by_advanced_search_with_foresight GET /foresight/flights/search/advanced
get_flight_position_with_foresight GET /foresight/flights/{id}/position
get_all_airports GET /airports
get_nearby_airports GET /airports/nearby
get_delays_for_all_airports GET /airports/delays
get_airport GET /airports/{id}
get_airports_canonical GET /airports/{id}/canonical
get_airports_near_airport GET /airports/{id}/nearby
get_airport_delays GET /airports/{id}/delays
get_airport_flights GET /airports/{id}/flights
get_airport_flights_arrived GET /airports/{id}/flights/arrivals
get_airport_flights_arrivals_cancellations GET /airports/{id}/flights/arrivals/cancellations
get_airport_flights_departed GET /airports/{id}/flights/departures
get_airport_flights_departures_cancellations GET /airports/{id}/flights/departures/cancellations
get_airport_flights_scheduled_departures GET /airports/{id}/flights/scheduled_departures
get_airport_flights_scheduled_arrivals GET /airports/{id}/flights/scheduled_arrivals
get_flights_between_airports GET /airports/{id}/flights/to/{dest_id}
get_airport_flights_count GET /airports/{id}/flights/counts
get_airport_weather_observations GET /airports/{id}/weather/observations
get_airport_weather_forecast GET /airports/{id}/weather/forecast
get_routes_between_airports GET /airports/{id}/routes/{dest_id}
get_all_operators GET /operators
get_operator GET /operators/{id}
get_operators_canonical GET /operators/{id}/canonical
get_operator_flights GET /operators/{id}/flights
get_operator_flights_scheduled GET /operators/{id}/flights/scheduled
get_operator_flights_arrived GET /operators/{id}/flights/arrivals
get_operator_flights_enroute GET /operators/{id}/flights/enroute
get_operator_flights_cancellations GET /operators/{id}/flights/cancellations
get_operator_flights_count GET /operators/{id}/flights/counts
get_all_alerts GET /alerts
create_alert POST /alerts
get_alert GET /alerts/{id}
update_alert PUT /alerts/{id}
delete_alert DELETE /alerts/{id}
get_alerts_endpoint GET /alerts/endpoint
set_alerts_endpoint PUT /alerts/endpoint
delete_alerts_endpoint DELETE /alerts/endpoint
get_history_flight GET /history/flights/{ident}
get_history_flight_track GET /history/flights/{id}/track
get_history_flight_map GET /history/flights/{id}/map
get_history_flight_route GET /history/flights/{id}/route
get_history_aircraft_last_flight GET /history/aircraft/{registration}/last_flight
get_aircraft_blocked GET /aircraft/{ident}/blocked
get_aircraft_owner GET /aircraft/{ident}/owner
get_flight_type GET /aircraft/types/{type}
get_schedules_by_date GET /schedules/{date_start}/{date_end}
get_all_disruption_counts GET /disruption_counts/{entity_type}
get_disruption_counts GET /disruption_counts/{entity_type}/{id}
get_history_airports_flights_arrived GET /history/airports/{id}/flights/arrivals
get_history_airports_flights_arrivals_cancellations GET /history/airports/{id}/flights/arrivals/cancellations
get_history_airports_flights_departed GET /history/airports/{id}/flights/departures
get_history_airports_flights_departures_cancellations GET /history/airports/{id}/flights/departures/cancellations
get_history_flights_between_airports GET /history/airports/{id}/flights/to/{dest_id}
get_history_operators_flights GET /history/operators/{id}/flights
get_history_operators_flights_cancellations GET /history/operators/{id}/flights/cancellations
get_account_usage GET /account/usage
`;

const env = { AIRNAVRADAR_API_TOKEN: ' Bearer airnav-fixture ', FLIGHTAWARE_API_KEY: ' flightaware-fixture ' };
const raw = ' { "upstream": true }\n';
const start = '2026-11-23T06:00:00Z';
const end = '2026-11-23T09:00:00Z';
const range = { start, end };
const geo = { fromDate: start, toDate: end, minLatitude: 0, maxLatitude: 2, minLongitude: 126, maxLongitude: 127, includeFlightPaths: false };
const search = { fromDate: start, toDate: end, flightIds: ['FX5926'], includeFlightPaths: false, includeFlightUrls: false };
const postQueries = { geosearch: geo, search, aircraftPosition: { registrations: ['N123FE'], incLastKnownPos: false } };
const events = { arrival: true, cancelled: false, departure: false, diverted: false, filed: false, out: false, off: false, on: false, in: false, hold_start: false, hold_end: false };
const alert = { ident: 'FDX5926', origin: null, destination: 'RKSI', aircraft_type: null, start: null, end: null, eta: 0, events, target_url: null, impending_arrival: [10], impending_departure: null };
const accountBodies = {
  post_flights_by_ident: { aircraft_type: 'B77L', origin: 'ZGGG', destination: 'RKSI', intended_off: start, intended_on: end },
  create_alert: alert,
  update_alert: { ...alert, enabled: false },
  set_alerts_endpoint: { url: 'https://receiver.example/flight-events' },
};
const querySamples = {
  getAircraft: { registration: 'N123FE', includeStatistics: false },
  searchAirport: { onlyMajor: false, latitude1: 0 },
  usage: { fromDate: start, toDate: end },
  geosearch: { page: 2, pageSize: 5 },
  search: { page: 3, pageSize: 4 },
  get_nearby_airports: { latitude: 0, longitude: 126.5, radius: 50 },
  get_airports_near_airport: { radius: 50 },
  get_flights_by_position_search: { unique_flights: false, cursor: 'opaque+=/next' },
  get_flight_map: { layer_on: ['country boundaries', 'track'], show_data_block: false },
  get_flight_track: { include_estimated_positions: false },
  get_all_alerts: { max_pages: 0 },
  get_history_airports_flights_arrived: range,
  get_history_airports_flights_arrivals_cancellations: range,
  get_history_airports_flights_departed: range,
  get_history_airports_flights_departures_cancellations: range,
  get_history_flights_between_airports: { ...range, airline: 'FDX', type: 'Airline' },
  get_history_operators_flights: range,
  get_history_operators_flights_cancellations: range,
  get_account_usage: { ...range, all_keys: false },
};
const pathSamples = {
  id: 'FDX5926-1764056114-airline-0000',
  icaoCode: 'RKSI',
  ident: 'FDX5926',
  registration: 'N123FE',
  dest_id: 'RJAA',
  entity_type: 'airline',
  type: 'B77L',
  date_start: start,
  date_end: end,
};

async function call(name, args, settings = env) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), settings);
  const payload = await response.json();
  assert.equal(payload.error, undefined, JSON.stringify(payload.error));
  return payload.result;
}

function mockFetch(t, responseFor = () => new Response(raw)) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (resource, options) => {
    const request = { url: new URL(resource), method: options.method, headers: new Headers(options.headers), body: options.body };
    requests.push(request);
    return responseFor(request);
  });
  return requests;
}

function source(result, provider) {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(result.structuredContent.providers.length, 1);
  const [row] = result.structuredContent.providers;
  assert.equal(row.provider, provider);
  return row;
}

function pathParams(template, id) {
  return Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map(([, name]) => {
    if (name === 'id') {
      if (template.startsWith('/alerts/')) return [name, 123];
      if (template.includes('/airports/')) return [name, 'RKSI'];
      if (template.includes('/operators/') || template.startsWith('/disruption_counts/')) return [name, 'FDX'];
    }
    if (id === 'getAirlineStatistics') return [name, 'FDX'];
    return [name, pathSamples[name]];
  }));
}

test('AirNav and FlightAware expose and dispatch every documented method and path', async (t) => {
  const requests = mockFetch(t);
  for (const [provider, knownOperations, count, base, authHeader, authValue] of [
    ['airnavradar', airNavOperations, 26, 'https://api.airnavradar.com/v2', 'authorization', 'Bearer airnav-fixture'],
    ['flightaware', flightAwareOperations, 69, 'https://aeroapi.flightaware.com/aeroapi', 'x-apikey', 'flightaware-fixture'],
  ]) {
    const expected = knownOperations.trim().split('\n');
    assert.equal(expected.length, count);
    const beforeCatalog = requests.length;
    const catalog = await call('aviation_native_endpoints', { provider }, {});
    assert.equal(requests.length, beforeCatalog);
    assert.deepEqual(catalog.structuredContent.endpoints.map(({ id, method, path }) => `${id} ${method} ${path}`).sort(), expected.toSorted());
    assert.equal(catalog.structuredContent.endpoints.filter(({ changes_account }) => changes_account).length, provider === 'airnavradar' ? 0 : 6);
    for (const entry of expected) {
      const [id, method, path] = entry.split(' ');
      const pathValues = pathParams(path, id);
      const query = querySamples[id] ?? {};
      const body = postQueries[id] ?? accountBodies[id];
      const changesAccount = provider === 'flightaware' && method !== 'GET';
      const tool = changesAccount ? 'aviation_native_manage' : 'aviation_native_lookup';
      const previous = requests.length;
      const result = await call(tool, { nativeProvider: provider, nativeEndpoint: id, nativeParams: { ...pathValues, ...query }, nativeBody: body });
      const row = source(result, provider);
      assert.equal(row.status, 'ok', `${entry}: ${row.detail ?? ''}`);
      assert.equal(row.changes_account, changesAccount, entry);
      assert.equal(row.native_endpoint, id);
      assert.equal(row.upstream_method, method);
      assert.equal(requests.length, previous + 1, entry);
      const request = requests[previous];
      const expectedUrl = new URL(base + path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(pathValues[key])));
      assert.equal(request.url.origin, expectedUrl.origin, entry);
      assert.equal(request.url.pathname, expectedUrl.pathname, entry);
      const expectedQuery = Object.entries(query).flatMap(([key, value]) => [value].flat().map((item) => [key, String(item)]));
      assert.deepEqual([...request.url.searchParams.entries()], expectedQuery, entry);
      assert.equal(request.headers.get(authHeader), authValue, entry);
      assert.equal(request.method, method, entry);
      if (body) {
        assert.match(request.headers.get('content-type'), /^application\/json\b/, entry);
        assert.deepEqual(JSON.parse(request.body), body, entry);
      } else assert.equal(request.body, undefined, entry);
      assert.equal(result.content[row.raw_body_content_index].text, raw, entry);
    }
  }
});

test('AirNav native lookup keeps returned credits, pagination and billing values', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse(start));
  const searchResponse = ' { "cost": 3, "page": 3, "totalPages": 4, "flights": [] }\n';
  const billingResponse = ' { "cost": 0, "isUnlimited": false, "credits": 0 }\n';
  const requests = mockFetch(t, ({ url }) => new Response(url.pathname.endsWith('/search') ? searchResponse : billingResponse, {
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' },
  }));
  const first = await call('aviation_native_lookup', { nativeProvider: 'airnavradar', nativeEndpoint: 'search', nativeParams: { page: 3, pageSize: 4 }, nativeBody: search });
  const movement = source(first, 'airnavradar');
  assert.equal(movement.charged_credits, 3);
  assert.equal(movement.quota_headers['x-ratelimit-remaining'], '0');
  assert.equal(first.structuredContent.pacing_policy, 'advisory');
  assert.equal(Date.parse(movement.recommended_next_at), Date.parse(start) + 3 * movement.interval_ms);
  assert.equal(first.content[movement.raw_body_content_index].text, searchResponse);
  assert.equal(requests[0].url.searchParams.get('page'), '3');

  const second = await call('aviation_native_lookup', { nativeProvider: 'airnavradar', nativeEndpoint: 'status' });
  const billing = source(second, 'airnavradar');
  assert.equal(billing.charged_credits, 0);
  assert.equal(second.content[billing.raw_body_content_index].text, billingResponse);
});

test('FlightAware native map preserves upstream PNG bytes', async (t) => {
  const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const requests = mockFetch(t, () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
  const result = await call('aviation_native_lookup', { nativeProvider: 'flightaware', nativeEndpoint: 'get_flight_map', nativeParams: { id: pathSamples.id } });
  const row = source(result, 'flightaware');
  assert.equal(requests.length, 1);
  assert.equal(row.content_type, 'image/png');
  assert.equal(row.raw_body_encoding, 'base64');
  assert.deepEqual(Buffer.from(result.content[row.raw_body_content_index].text, 'base64'), Buffer.from(bytes));
});

test('Native lookup rejects missing credentials, invalid parameters and account changes before fetch', async (t) => {
  const requests = mockFetch(t);
  const searchInput = { nativeProvider: 'airnavradar', nativeEndpoint: 'search', nativeBody: search };
  const edit = { nativeProvider: 'flightaware', nativeEndpoint: 'update_alert', nativeParams: { id: 123 }, nativeBody: accountBodies.update_alert };
  for (const [input, variable] of [[searchInput, 'AIRNAVRADAR_API_TOKEN'], [edit, 'FLIGHTAWARE_API_KEY']]) {
    const response = await call(input === edit ? 'aviation_native_manage' : 'aviation_native_lookup', input, {});
    const row = source(response, input.nativeProvider);
    assert.equal(row.status, 'missing_credentials');
    assert.deepEqual(row.missing_environment_variables, [variable]);
    assert.equal(row.upstream_attempted, false);
  }
  const bad = [
    ['aviation_native_lookup', edit],
    ['aviation_native_lookup', { ...edit, confirmNativeChange: true }],
    ['aviation_native_manage', searchInput],
    ['aviation_native_manage', { ...edit, nativeBody: { ...accountBodies.update_alert, enabled: 'false' } }],
    ['aviation_native_lookup', { ...searchInput, nativeBody: { ...search, includeFlightPaths: 'false' } }],
    ['aviation_native_lookup', { ...searchInput, nativeEndpoint: 'geosearch' }],
    ['aviation_native_lookup', { ...edit, nativeEndpoint: 'get_history_flights_between_airports', nativeParams: { id: 'RKSI', dest_id: 'RJAA' }, nativeBody: undefined }],
    ['aviation_native_lookup', { ...edit, nativeEndpoint: 'get_alert', nativeParams: { id: '123' }, nativeBody: undefined }],
    ['aviation_native_lookup', { ...edit, nativeEndpoint: 'get_flight', nativeParams: { ident: '../alerts' }, nativeBody: undefined }],
  ];
  for (const [tool, input] of bad) {
    const result = await call(tool, input);
    assert.ok(result.isError || result.structuredContent.providers[0].status === 'unsupported_input', JSON.stringify(input));
  }
  assert.deepEqual(requests, []);
});

test('Native FlightAware write requires explicit web confirmation', async (t) => {
  const requests = mockFetch(t, () => new Response(null, { status: 204 }));
  const input = { operation: 'native', nativeProvider: 'flightaware', nativeEndpoint: 'delete_alert', nativeParams: { id: 123 } };
  async function stream(args) {
    const response = await worker.fetch(new Request('https://site.test/lookup/stream', {
      method: 'POST',
      headers: { origin: 'https://site.test', 'content-type': 'application/json' },
      body: JSON.stringify(args),
    }), env);
    return (await response.text()).trim().split('\n').map(JSON.parse);
  }
  const rejected = await stream(input);
  assert.equal(rejected[0].type, 'error');
  assert.deepEqual(requests, []);
  const confirmed = await stream({ ...input, confirmNativeChange: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'DELETE');
  assert.equal(requests[0].url.pathname, '/aeroapi/alerts/123');
  const row = confirmed.at(-1).structuredContent.providers[0];
  assert.equal(row.status, 'ok');
  assert.equal(row.http_status, 204);
});

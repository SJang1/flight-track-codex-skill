import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const env = { AERODATABOX_API_KEY: ' direct-fixture ' };
const rawJson = ' { "data": [ 1 ] }\n';
const rawXml = '<?xml version="1.0"?>\n<fixture>raw</fixture>\n';
const day = '2026-11-23';
const nextDay = '2026-11-24';
const clock = `${day}T06:00`;
const close = `${day}T10:00`;
const subscriptionId = '84179850-1175-4ed0-bb2a-ddc93e34c9f1';
const airport = { codeType: 'Iata', code: 'ICN' };
const aircraft = { searchBy: 'Reg', searchParam: 'PH-BXO' };
const flight = { searchBy: 'Number', searchParam: 'FX5926' };
const feed = { service: 'AdsbUpdates' };
const boardFlags = { direction: 'Departure', withLeg: true, withCancelled: false, withCodeshared: false, withCargo: true, withPrivate: false, withLocation: true };

// Independent contract fixture from the Direct 1.15.4.0 specification.
// [operationId, route template, path parameters, query parameters]
const reads = [
  ['GetAircraft', '/aircrafts/{searchBy}/{searchParam}', aircraft, { withImage: true, withRegistrations: false }],
  ['GetAircraftRegistrations', '/aircrafts/{searchBy}/{searchParam}/registrations', { searchBy: 'Icao24', searchParam: '484161' }],
  ['GetAllAircraft', '/aircrafts/{searchBy}/{searchParam}/all', { searchBy: 'Id', searchParam: '10001' }, { withImage: false, withRegistrations: true }],
  ['GetAirlineFleet', '/airlines/{airlineCode}/aircrafts', { airlineCode: 'KAL' }, { pageSize: 10, pageOffset: 0, withRegistrations: false }],
  ['GetAircraftImageByRegistration', '/aircrafts/reg/{reg}/image/beta', { reg: 'PH BXO' }],
  ['SearchAircraftByTerm', '/aircrafts/search/term', {}, { q: 'Boeing 737 + MAX & family', limit: 5 }],
  ['GetAirport', '/airports/{codeType}/{code}', airport, { withRunways: true, withTime: false }],
  ['GetAirportRunways', '/airports/{codeType}/{code}/runways', { codeType: 'Icao', code: 'RKSI' }],
  ['SearchAirportsByLocation', '/airports/search/location', {}, { lat: 0, lon: 126.45, radiusKm: 100, limit: 25, withFlightInfoOnly: false }],
  ['SearchAirportsByIpGeoLocation', '/airports/search/ip', {}, { q: '8.8.8.8', radiusKm: 75, limit: 10, withFlightInfoOnly: true }],
  ['SearchAirportByTerm', '/airports/search/term', {}, { q: 'Seoul', limit: 12, withFlightInfoOnly: false, withSearchByCode: false }],
  ['GetWebhook', '/subscriptions/webhook/{subscriptionId}', { subscriptionId }],
  ['GetWebhookList', '/subscriptions/webhook'],
  ['GetBalance', '/subscriptions/balance'],
  ['GetFlight_FlightNearest', '/flights/{searchBy}/{searchParam}', { searchBy: 'CallSign', searchParam: 'FDX5926' }, { dateLocalRole: 'Both', withAircraftImage: false, withLocation: true, withFlightPlan: false }],
  ['GetFlight_FlightOnSpecificDate', '/flights/{searchBy}/{searchParam}/{dateLocal}', { ...flight, dateLocal: day }, { dateLocalRole: 'Arrival', withAircraftImage: true, withLocation: false, withFlightPlan: true }],
  ['GetFlightHistory_FlightHistory', '/flights/{searchBy}/{searchParam}/{dateFromLocal}/{dateToLocal}', { ...flight, dateFromLocal: day, dateToLocal: nextDay }, { dateLocalRole: 'Departure' }],
  ['GetFlightDates_FlightDatesAll', '/flights/{searchBy}/{searchParam}/dates', flight],
  ['GetFlightDates_FlightDatesInRange', '/flights/{searchBy}/{searchParam}/dates/{fromLocal}/{toLocal}', { ...flight, fromLocal: day, toLocal: nextDay }],
  ['GetAirportFlights', '/flights/airports/{codeType}/{code}/{fromLocal}/{toLocal}', { ...airport, fromLocal: clock, toLocal: close }, boardFlags],
  ['GetAirportFlightsRelative', '/flights/airports/{codeType}/{code}', airport, { ...boardFlags, offsetMinutes: -60, durationMinutes: 240 }],
  ['SearchFlightsByTerm', '/flights/search/term', {}, { q: 'FX59', limit: 10 }],
  ['GetFeedServiceStatus', '/health/services/feeds/{service}', feed, { withHttpCode: false }],
  ['GetAirportFeedStatus', '/health/services/airports/{icao}/feeds', { icao: 'RKSI' }],
  ['GetFeedAirports', '/health/services/feeds/{service}/airports', { service: 'FlightSchedules' }],
  ['GetFaaLaddAircraftStatus', '/industry/faa-ladd/{id}/status', { id: 'N123FE' }],
  ['GetAirportLocalTime', '/airports/{codeType}/{code}/time/local', airport],
  ['GetAirportSolarTime_SolarTimeCurrent', '/airports/{codeType}/{code}/time/solar', airport],
  ['GetAirportSolarTime_SolarTimeSpecificDate', '/airports/{codeType}/{code}/time/solar/{dateLocal}', { ...airport, dateLocal: clock }],
  ['GetAirportDistanceTime', '/airports/{codeType}/{codeFrom}/distance-time/{codeTo}', { codeType: 'Iata', codeFrom: 'ICN', codeTo: 'NRT' }, { aircraftName: 'Boeing 777-300ER', flightTimeModel: 'ML01' }],
  ['GetAirportDelay_DelaysCurrent', '/airports/{codeType}/{code}/delays', airport],
  ['GetAirportDelay_DelaysHistorical', '/airports/{codeType}/{code}/delays/{dateLocal}', { ...airport, dateLocal: clock }],
  ['GetAirportDelays', '/airports/{codeType}/{code}/delays/{dateFromLocal}/{dateToLocal}', { ...airport, dateFromLocal: clock, dateToLocal: `${nextDay}T06:00` }],
  ['GetRouteDailyStatistics_RoutesDailyCurrent', '/airports/{codeType}/{code}/stats/routes/daily', airport],
  ['GetRouteDailyStatistics_RoutesDailAtSpecificDate', '/airports/{codeType}/{code}/stats/routes/daily/{dateLocal}', { ...airport, dateLocal: day }],
  ['GetGlobalDelays_GlobalDelaysCurent', '/airports/delays'],
  ['GetGlobalDelays_GlobalDelaysAtSpecificDate', '/airports/delays/{dateUtc}', { dateUtc: clock }],
  ['GetFlightDelays', '/flights/{number}/delays', { number: 'FX5926' }],
];

// [operationId, method, route template, path parameters, JSON body]
const writes = [
  ['SubscribeWebhook', 'POST', '/subscriptions/webhook/{subjectType}/{subjectId}', { subjectType: 'FlightByNumber', subjectId: 'FX5926' }, { url: 'https://example.org/flight-events', maxDeliveryRetries: 0 }],
  ['UnsubscribeWebhook', 'DELETE', '/subscriptions/webhook/{subscriptionId}', { subscriptionId }],
  ['RefillBalance', 'POST', '/subscriptions/balance/refill', {}, { credits: 11 }],
];

async function rpc(method, params, settings = env) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), settings);
  const result = await response.json();
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.result;
}

function lookup(aerodataBoxEndpoint, aerodataBoxParams, fields, settings) {
  return rpc('tools/call', {
    name: 'aviation_lookup',
    arguments: { operation: 'aerodatabox', aerodataBoxEndpoint, aerodataBoxParams, ...fields },
  }, settings);
}

function manage(argumentsObject, settings) {
  return rpc('tools/call', { name: 'aviation_aerodatabox_manage', arguments: argumentsObject }, settings);
}

function fixture(t) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const headers = new Headers(options.headers);
    requests.push({ url: new URL(url), method: options.method, headers, body: options.body });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const xml = headers.get('Accept') === 'application/xml';
    return new Response(xml ? rawXml : rawJson, { headers: { 'content-type': xml ? 'application/xml' : 'application/json' } });
  });
  return requests;
}

function source(result) {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(result.structuredContent.providers.length, 1);
  const [row] = result.structuredContent.providers;
  assert.equal(row.provider, 'aerodatabox');
  return row;
}

function assertPath(request, pattern, params, id) {
  const expected = pattern.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(params[key]));
  assert.equal(request.url.origin, 'https://api.aerodatabox.com', id);
  assert.equal(request.url.pathname, expected, id);
  assert.equal(request.headers.get('x-api-key'), 'direct-fixture', id);
}

test('AeroDataBox catalogs every Direct operation and describes account writes separately', async (t) => {
  const requests = fixture(t);
  const [listing, catalog] = await Promise.all([
    rpc('tools/list', {}),
    rpc('tools/call', { name: 'aviation_providers', arguments: {} }, {}),
  ]);
  const provider = catalog.structuredContent.providers.find(({ id }) => id === 'aerodatabox');
  assert.deepEqual(provider.required_environment_variables, ['AERODATABOX_API_KEY']);
  assert.equal(provider.credentials, 'missing');
  const expected = [
    ...reads.map(([id, path]) => `GET ${id} ${path}`),
    ...writes.map(([id, method, path]) => `${method} ${id} ${path}`),
  ].sort();
  assert.deepEqual(provider.aerodatabox_endpoints.map(({ id, method, path }) => `${method} ${id} ${path}`).sort(), expected);
  const requiredQuery = {
    GetAirlineFleet: ['pageSize'],
    SearchAircraftByTerm: ['q'],
    SearchAirportsByLocation: ['lat', 'lon', 'radiusKm', 'limit'],
    SearchAirportsByIpGeoLocation: ['q', 'radiusKm', 'limit'],
    SearchAirportByTerm: ['q'],
    SearchFlightsByTerm: ['q'],
  };
  for (const [id, , pathParams = {}, query = {}] of reads) {
    const endpoint = provider.aerodatabox_endpoints.find((item) => item.id === id);
    assert.deepEqual(endpoint.params.toSorted(), Object.keys({ ...pathParams, ...query }).sort(), id);
    assert.deepEqual(endpoint.required.toSorted(), [...Object.keys(pathParams), ...(requiredQuery[id] ?? [])].sort(), id);
  }
  const lookupTool = listing.tools.find(({ name }) => name === 'aviation_lookup');
  const manageTool = listing.tools.find(({ name }) => name === 'aviation_aerodatabox_manage');
  assert.equal(lookupTool.annotations.readOnlyHint, true);
  assert.equal(manageTool.annotations.readOnlyHint, false);
  assert.deepEqual(lookupTool.inputSchema.properties.aerodataBoxEndpoint.enum.toSorted(), reads.map(([id]) => id).sort());
  assert.deepEqual(manageTool.inputSchema.properties.aerodataBoxEndpoint.enum.toSorted(), writes.map(([id]) => id).sort());
  assert.deepEqual(requests, []);
});

test('AeroDataBox dispatches every documented GET exactly once with native path and query fields', async (t) => {
  const requests = fixture(t);
  for (const [index, [id, path, pathParams = {}, query = {}]] of reads.entries()) {
    const format = id === 'GetAirportRunways' ? 'xml' : undefined;
    const result = await lookup(id, { ...pathParams, ...query }, format && { format });
    const row = source(result);
    assert.equal(row.status, 'ok', id);
    assert.equal(row.aerodatabox_endpoint, id);
    assert.equal(row.upstream_method, 'GET', id);
    assert.equal(requests.length, index + 1, id);
    const request = requests.at(-1);
    assertPath(request, path, pathParams, id);
    assert.equal(request.method, 'GET', id);
    assert.deepEqual(Object.fromEntries(request.url.searchParams),
      Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])), id);
    assert.equal(request.body, undefined, id);
    assert.equal(result.content[row.raw_body_content_index].text, format === 'xml' ? rawXml : rawJson, id);
    assert.equal(row.raw_body_encoding, 'utf-8', id);
  }
});

test('AeroDataBox sends native methods and typed JSON from the explicit management tool', async (t) => {
  const requests = fixture(t);
  for (const [id, method, path, pathParams, body] of writes) {
    const result = await manage({ aerodataBoxEndpoint: id, aerodataBoxParams: pathParams, aerodataBoxBody: body, format: 'xml' });
    const row = source(result);
    assert.equal(row.aerodatabox_endpoint, id);
    assert.equal(row.upstream_method, method);
    assert.equal(row.status, 'ok');
    assert.equal(row.quota_configuration_error, undefined);
    const request = requests.at(-1);
    assertPath(request, path, pathParams, id);
    assert.equal(request.method, method);
    assert.equal(request.url.search, '');
    assert.equal(request.headers.get('accept'), 'application/xml');
    if (body) {
      assert.equal(request.headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(request.body), body, id);
      assert.equal(result.content[row.raw_body_content_index].text, rawXml, id);
    } else {
      assert.equal(request.body, undefined);
      assert.equal(row.http_status, 204);
    }
  }
  assert.equal(requests.length, writes.length);
});

test('AeroDataBox rejects invalid input without calling any provider', async (t) => {
  const requests = fixture(t);
  assert.equal(source(await lookup('GetBalance', {}, {}, {})).status, 'missing_credentials');
  assert.equal(source(await manage({ aerodataBoxEndpoint: 'RefillBalance', aerodataBoxBody: { credits: 2 } }, {})).status, 'missing_credentials');
  const invalidReads = [
    ['GetAircraft', { searchParam: aircraft.searchParam }],
    ['GetAircraft', { searchBy: 'Number', searchParam: aircraft.searchParam }],
    ['GetAircraft', { ...aircraft, searchParam: '..' }],
    ['GetAircraft', { ...aircraft, searchParam: 'PH/BXO' }],
    ['GetAircraft', { ...aircraft, withTime: true }],
    ['GetAirport', { ...airport, withTime: 'false' }],
    ['SearchAirportsByLocation', { lat: 0, lon: 126.45, radiusKm: 100 }],
    ['GetBalance', {}, { providers: ['adsb_fi'] }],
    ['GetBalance', {}, { excludeProviders: ['aerodatabox'] }],
    ['GetBalance', {}, { ident: 'FX5926' }],
    ['RefillBalance', {}, { confirmAeroDataBoxChange: true, aerodataBoxBody: { credits: 2 } }],
  ];
  for (const args of invalidReads) {
    const result = await lookup(...args);
    assert.ok(result.isError || result.structuredContent.providers[0].status === 'unsupported_input', JSON.stringify(args));
  }
  const invalidWrites = [
    { aerodataBoxEndpoint: 'GetWebhookList' },
    { aerodataBoxEndpoint: 'RefillBalance' },
    { aerodataBoxEndpoint: 'RefillBalance', aerodataBoxBody: { credits: '2' } },
    { aerodataBoxEndpoint: 'RefillBalance', aerodataBoxBody: { credits: 0 } },
    { aerodataBoxEndpoint: 'RefillBalance', aerodataBoxBody: { credits: 2, extra: true } },
    { aerodataBoxEndpoint: 'UnsubscribeWebhook', aerodataBoxParams: { subscriptionId: '../balance/refill' } },
    { aerodataBoxEndpoint: 'SubscribeWebhook', aerodataBoxParams: { subjectType: 'FlightByNumber', subjectId: 'FX5926' }, aerodataBoxBody: { url: 'https://example.org/flight-events', maxDeliveryRetries: 3 } },
  ];
  for (const args of invalidWrites) {
    const result = await manage(args);
    assert.ok(result.isError || result.structuredContent.providers[0].status === 'unsupported_input', JSON.stringify(args));
  }
  assert.deepEqual(requests, []);
});

test('AeroDataBox browser management requires acknowledgement before sending the mutation', async (t) => {
  const requests = fixture(t);
  const input = { operation: 'aerodatabox', aerodataBoxEndpoint: 'RefillBalance', aerodataBoxBody: { credits: 2 } };
  const stream = async (args) => {
    const response = await worker.fetch(new Request('https://site.test/lookup/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://site.test' },
      body: JSON.stringify(args),
    }), env);
    assert.equal(response.status, 200);
    return (await response.text()).trim().split('\n').map(JSON.parse);
  };
  const declined = await stream(input);
  assert.ok(declined.some(({ type, structuredContent }) =>
    type === 'error' || structuredContent?.providers[0].status === 'unsupported_input'));
  assert.deepEqual(requests, []);
  const confirmed = await stream({ ...input, confirmAeroDataBoxChange: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(confirmed.at(-1).structuredContent.providers[0].aerodatabox_endpoint, 'RefillBalance');
  assert.equal(confirmed.find(({ type }) => type === 'provider').raw_body, rawJson);
});

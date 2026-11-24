import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flightradar24Provider } from '../src/flightradar24-provider.js';
import worker from '../src/index.js';

const env = { FLIGHTRADAR24_API_KEY: 'Bearer demo-fr24-key' };
const { operations } = flightradar24Provider;
const liveFlight = { operation: 'flight', identType: 'flight_number', ident: 'KE703' };
const route = { operation: 'airport', direction: 'departure', airport: 'ICN', oppositeAirport: 'NRT' };

test('Flightradar24 sends its documented Bearer, version and live filters', () => {
  assert.equal(operations.flight(liveFlight, {}), null);
  assert.deepEqual(flightradar24Provider.keys, ['FLIGHTRADAR24_API_KEY']);
  const flight = operations.flight(liveFlight, env);
  assert.equal(flight.url.origin, 'https://fr24api.flightradar24.com');
  assert.equal(flight.url.pathname, '/api/live/flight-positions/full');
  assert.deepEqual(flight.headers, { Authorization: 'Bearer demo-fr24-key', Accept: 'application/json', 'Accept-Version': 'v1' });
  assert.deepEqual(Object.fromEntries(flight.url.searchParams), { flights: 'KE703', limit: '10' });
  const position = { operation: 'live', identType: 'registration', ident: 'HL8008' };
  const live = operations.live(position, env);
  assert.equal(live.url.pathname, '/api/live/flight-positions/light');
  assert.deepEqual(Object.fromEntries(live.url.searchParams), { registrations: 'HL8008', limit: '1' });
  assert.equal(operations.live({ ...position, limit: 4 }, env).url.searchParams.get('limit'), '4');
  assert.deepEqual(flightradar24Provider.limits(position, { FLIGHTRADAR24_MONTHLY_CREDITS: '600' }), [
    { requests: 10, windowMs: 60_000 }, { requests: 100, windowMs: 31 * 86_400_000 },
  ]);
  const airport = operations.airport({ operation: 'airport', airport: 'GMP', direction: 'arrival', limit: 2 }, env);
  assert.deepEqual(Object.fromEntries(airport.url.searchParams), { airports: 'inbound:GMP', limit: '2' });
  const both = operations.airport({ operation: 'airport', airport: 'LHR' }, env);
  assert.deepEqual(Object.fromEntries(both.url.searchParams), { airports: 'LHR', limit: '10' });
  const outbound = operations.airport(route, env);
  assert.deepEqual(Object.fromEntries(outbound.url.searchParams), { routes: 'ICN-NRT', limit: '10' });
  const inbound = operations.airport({ ...route, direction: 'arrival' }, env);
  assert.deepEqual(Object.fromEntries(inbound.url.searchParams), { routes: 'NRT-ICN', limit: '10' });
});

test('Flightradar24 sends UTC summary ranges, historical snapshots and track IDs', () => {
  const summary = operations.airport({ ...route, date: '2025-01-20' }, env);
  assert.equal(summary.url.pathname, '/api/flight-summary/light');
  assert.deepEqual(Object.fromEntries(summary.url.searchParams), {
    routes: 'ICN-NRT', flight_datetime_from: '2025-01-19T15:00:00Z', flight_datetime_to: '2025-01-20T14:59:59Z', limit: '10',
  });
  const history = { operation: 'history', identType: 'callsign', ident: 'KAL703', start: '2025-01-20T03:00:00+09:00' };
  const range = operations.history({ ...history, end: '2025-01-20T06:30:00+09:00' }, env);
  assert.deepEqual(Object.fromEntries(range.url.searchParams), {
    callsigns: 'KAL703', flight_datetime_from: '2025-01-19T18:00:00Z', flight_datetime_to: '2025-01-19T21:30:00Z', limit: '10',
  });
  const snapshot = operations.history(history, env);
  assert.equal(snapshot.url.pathname, '/api/historic/flight-positions/light');
  assert.deepEqual(Object.fromEntries(snapshot.url.searchParams), { callsigns: 'KAL703', timestamp: '1737309600', limit: '1' });
  const providerId = { identType: 'provider_id', ident: '333ca4a2' };
  const track = operations.track({ ...providerId, operation: 'track' }, env);
  assert.equal(track.url.pathname, '/api/flight-tracks');
  assert.deepEqual(Object.fromEntries(track.url.searchParams), { flight_id: '333ca4a2' });
  const legSummary = operations.flight({ ...providerId, operation: 'flight' }, env);
  assert.equal(legSummary.url.pathname, '/api/flight-summary/light');
  assert.deepEqual(Object.fromEntries(legSummary.url.searchParams), { flight_ids: '333ca4a2' });
});

test('Flightradar24 uses a local clock window for the airport day', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-24T23:00:00Z'));
  const window = { ...route, airport: 'RKSI', fromTime: '0000', toTime: '0700' };
  const summary = operations.airport(window, env);
  assert.equal(summary.url.pathname, '/api/flight-summary/light');
  assert.deepEqual(Object.fromEntries(summary.url.searchParams), {
    routes: 'RKSI-NRT', flight_datetime_from: '2026-11-24T15:00:00Z', flight_datetime_to: '2026-11-24T22:00:00Z', limit: '10',
  });
  const datedWindow = operations.airport({ ...route, date: '2026-11-25', fromTime: '0600', toTime: '1000' }, env);
  assert.deepEqual(Object.fromEntries(datedWindow.url.searchParams), {
    routes: 'ICN-NRT', flight_datetime_from: '2026-11-24T21:00:00Z', flight_datetime_to: '2026-11-25T01:00:00Z', limit: '10',
  });

  const dstDay = operations.history({
    ...liveFlight, operation: 'history', airport: 'JFK', date: '2025-03-09', timeZone: 'America/New_York',
  }, env);
  assert.deepEqual(Object.fromEntries(dstDay.url.searchParams), {
    flights: 'KE703', airports: 'JFK', flight_datetime_from: '2025-03-09T05:00:00Z',
    flight_datetime_to: '2025-03-10T03:59:59Z', limit: '10',
  });

  const budget = { FLIGHTRADAR24_MONTHLY_CREDITS: '6000' };
  assert.deepEqual(flightradar24Provider.limits({ ...window, limit: 2 }, budget), [
    { requests: 10, windowMs: 60_000 }, { requests: 1_000, windowMs: 31 * 86_400_000 },
  ]);
  assert.deepEqual(flightradar24Provider.limits({ ...liveFlight, fromTime: '0600', toTime: '1000', limit: 2 }, budget), [
    { requests: 10, windowMs: 60_000 }, { requests: 375, windowMs: 31 * 86_400_000 },
  ]);
  const explicit = operations.flight({ ...liveFlight, start: '2026-11-25T06:00:00+09:00', end: '2026-11-25T10:00:00+09:00' }, env);
  assert.deepEqual(Object.fromEntries(explicit.url.searchParams), {
    flights: 'KE703', flight_datetime_from: '2026-11-24T21:00:00Z', flight_datetime_to: '2026-11-25T01:00:00Z', limit: '10',
  });
});

test('Flightradar24 rejects filters it cannot send upstream', () => {
  assert.throws(() => operations.live({ operation: 'live', identType: 'icao24', ident: '4CAD41' }, env), /flight number, ADS-B callsign, or aircraft registration/);
  assert.throws(() => operations.airport({ operation: 'airport', identType: 'provider_id', ident: '333ca4a2' }, env), /IATA flight number/);
  assert.throws(() => operations.track({ ...liveFlight, operation: 'track' }, env), /provider_id/);
  assert.throws(() => operations.airport({ ...route, direction: undefined }, env), /direction/);
  assert.throws(() => operations.flight({ ...liveFlight, page: 2 }, env), /pagination/);
  assert.throws(() => operations.flight({ ...liveFlight, start: '2025-01-01T00:00:00Z', end: '2025-01-16T00:00:00Z' }, env), /14 days/);
  const fromTime = '0600';
  const toTime = '1000';
  assert.throws(() => operations.flight({ ...liveFlight, identType: 'callsign', ident: 'KAL703', fromTime, toTime }, env), /time ?zone|offset/i);
  assert.throws(() => operations.live({ ...liveFlight, operation: 'live', airport: 'ICN', fromTime, toTime }, env), /histor|date|window|range/i);
  assert.equal(operations.schedule, undefined);
});

test('Flightradar24 uses a credit budget only when explicitly configured', () => {
  const explorer = { FLIGHTRADAR24_PLAN: 'explorer' };
  const track = { operation: 'track' };
  const perMinute = [{ requests: 10, windowMs: 60_000 }];
  assert.deepEqual(flightradar24Provider.limits(track, explorer), perMinute);
  assert.deepEqual(flightradar24Provider.limits(track, { ...explorer, FLIGHTRADAR24_MONTHLY_CREDITS: 'invalid' }), perMinute);
  assert.deepEqual(flightradar24Provider.limits(track, { FLIGHTRADAR24_PLAN: 'essential' }), [{ requests: 30, windowMs: 60_000 }]);

  const budget = { ...explorer, FLIGHTRADAR24_MONTHLY_CREDITS: '60000' };
  assert.deepEqual(flightradar24Provider.limits(track, budget), [
    ...perMinute, { requests: 1_500, windowMs: 31 * 86_400_000 },
  ]);
  assert.deepEqual(flightradar24Provider.limits({ operation: 'fr24', fr24Endpoint: 'usage' }, budget), [{ requests: 1, windowMs: 60_000 }]);
  assert.deepEqual(flightradar24Provider.limits({ operation: 'fr24', fr24Endpoint: 'live_positions_count' }, budget), perMinute);
});

async function callTool(name, args, env) {
  const request = new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

function lookupFr24(args, env) {
  return callTool('aviation_lookup', args, env);
}

test('Exact flight lookups preserve local clock filters for Incheon and select FR24 by flight number', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-25T03:00:00Z'));
  const requests = [];
  const raw = '{ "data": [] }\n';
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(url));
    return new Response(raw);
  });

  const flight = {
    operation: 'flight', ident: 'FX5926', identType: 'flight_number', airport: 'ICN', direction: 'arrival',
    fromTime: '06:00', toTime: '10:00',
  };
  for (const date of ['2026-11-25', undefined]) {
    requests.length = 0;
    const result = await lookupFr24({ ...flight, date }, { ...env, INCHEON_CARGO_SERVICE_KEY: 'mock-incheon-key' });

    const fr24 = requests.filter(({ hostname }) => hostname === 'fr24api.flightradar24.com');
    assert.deepEqual(fr24.map(({ pathname }) => pathname), [date ? '/api/flight-summary/light' : '/api/live/flight-positions/full']);
    assert.deepEqual(Object.fromEntries(fr24[0].searchParams), {
      flights: 'FX5926', airports: 'inbound:ICN', limit: '10',
      ...(date ? { flight_datetime_from: '2026-11-24T15:00:00Z', flight_datetime_to: '2026-11-25T14:59:59Z' } : {}),
    });
    const incheon = requests.find(({ hostname }) => hostname === 'apis.data.go.kr');
    assert.match(incheon.pathname, /getCargoArrivalsDeOdp$/);
    assert.equal(incheon.searchParams.get('searchday'), '20261125');
    assert.equal(incheon.searchParams.get('from_time'), '0600');
    assert.equal(incheon.searchParams.get('to_time'), '1000');
    assert.equal(incheon.searchParams.get('flight_id'), 'FX5926');
    for (const provider of ['flightradar24', 'incheon_cargo']) {
      const source = result.structuredContent.providers.find((row) => row.provider === provider);
      assert.equal(source.status, 'ok');
      assert.equal(source.data_request_attempted, true);
      if (provider === 'flightradar24') assert.match(source.time_filter_note, /HHmm|clock|local time/i);
      assert.equal(result.content[source.raw_body_content_index].text, raw);
    }
  }
});

const testFlightId = '333ca4a2';
const timestamp = 1702383145;
const eventQuery = { flight_ids: testFlightId, event_types: 'takeoff,landed' };
const summaryQuery = {
  flight_datetime_from: '2025-01-20T00:00:00Z',
  flight_datetime_to: '2025-01-20T23:59:59Z',
  routes: 'ICN-NRT',
};

test('Flightradar24 forwards each of the 17 official selectors and returns the upstream body', async (t) => {
  const cases = [
    ['airports_light', '/static/airports/ICN/light', { code: 'ICN' }, {}],
    ['airports_full', '/static/airports/RKSI/full', { code: 'RKSI' }, {}],
    ['airlines_light', '/static/airlines/KAL/light', { icao: 'KAL' }, {}],
    ['live_positions_full', '/live/flight-positions/full', { flights: 'KE703', limit: 2 }],
    ['live_positions_light', '/live/flight-positions/light', { bounds: '42.473,37.331,-10.014,-4.115', limit: 2 }],
    ['live_positions_count', '/live/flight-positions/count', { airports: 'outbound:ICN' }],
    ['historic_positions_full', '/historic/flight-positions/full', { timestamp, registrations: 'HL8008', limit: 2 }],
    ['historic_positions_light', '/historic/flight-positions/light', { timestamp, data_sources: 'ADSB,MLAT', limit: 2 }],
    ['historic_positions_count', '/historic/flight-positions/count', { timestamp, routes: 'ICN-NRT' }],
    ['historic_events_full', '/historic/flight-events/full', eventQuery],
    ['historic_events_light', '/historic/flight-events/light', eventQuery],
    ['historic_events_count', '/historic/flight-events/count', eventQuery],
    ['flight_summary_full', '/flight-summary/full', { ...summaryQuery, sort: 'desc', limit: 2 }],
    ['flight_summary_light', '/flight-summary/light', { ...summaryQuery, limit: 2 }],
    ['flight_summary_count', '/flight-summary/count', summaryQuery],
    ['flight_tracks', '/flight-tracks', { flight_id: testFlightId }],
    ['usage', '/usage', { period: '7d' }],
  ];

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requested;
  const raw = ' { "data": [ 1 ] }\n';
  globalThis.fetch = async (url, options) => {
    assert.equal(requested, undefined, 'lookup must issue a single upstream request');
    requested = { url: new URL(url), options };
    return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
  };

  for (const [selector, path, params, query = params] of cases) {
    requested = undefined;
    const result = await lookupFr24({ operation: 'fr24', fr24Endpoint: selector, fr24Params: params }, env);
    assert.equal(result.isError, undefined, selector);
    assert.ok(requested, selector);
    assert.equal(requested.url.origin, 'https://fr24api.flightradar24.com', selector);
    assert.equal(requested.url.pathname, `/api${path}`, selector);
    assert.equal(requested.options.method, 'GET', selector);
    assert.equal(new Headers(requested.options.headers).get('Authorization'), 'Bearer demo-fr24-key', selector);
    assert.equal(new Headers(requested.options.headers).get('Accept-Version'), 'v1', selector);
    assert.deepEqual(Object.fromEntries(requested.url.searchParams),
      Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])), selector);
    assert.equal(result.structuredContent.providers.length, 1, selector);
    const [source] = result.structuredContent.providers;
    assert.equal(source.provider, 'flightradar24', selector);
    assert.equal(source.status, 'ok', selector);
    assert.equal(result.content[source.raw_body_content_index].text, raw, selector);
  }
});

test('Flightradar24 explicit requests enforce credentials and reject cross-provider or wrong-endpoint input', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response();
  };

  const usage = { operation: 'fr24', fr24Endpoint: 'usage', fr24Params: { period: '7d' } };
  const missing = await lookupFr24(usage, {});
  assert.equal(missing.structuredContent.providers[0].status, 'missing_credentials');
  assert.deepEqual(missing.structuredContent.providers[0].missing_environment_variables, ['FLIGHTRADAR24_API_KEY']);

  const invalid = [
    { ...usage, providers: ['adsb_fi'] },
    { ...usage, providers: ['flightradar24', 'adsb_fi'] },
    { ...usage, ident: 'KE703' },
    { ...usage, timeZone: 'Asia/Seoul' },
    { ...usage, fr24Params: { period: 'invalid' } },
    { ...usage, fr24Params: { period: '7d', limit: 4 } },
    { ...usage, fr24Endpoint: 'airports_full', fr24Params: { code: '../usage' } },
    { ...usage, fr24Endpoint: 'historic_positions_light', fr24Params: { callsigns: 'KAL703' } },
    { ...usage, fr24Endpoint: 'flight_summary_light', fr24Params: { flight_datetime_from: '2025-01-20T00:00:00Z' } },
  ];
  for (const input of invalid) {
    const result = await lookupFr24(input, env);
    assert.ok(result.isError || result.structuredContent.providers[0].status === 'unsupported_input', JSON.stringify(input));
  }
  assert.equal(requests, 0);
});

test('Flightradar24 validates the configured plan allowance, result cap, and history window before calling the provider', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };

  const explorer = { ...env, FLIGHTRADAR24_PLAN: 'explorer' };
  const essential = { ...env, FLIGHTRADAR24_PLAN: 'essential' };
  const advanced = { ...env, FLIGHTRADAR24_PLAN: 'advanced' };
  const catalog = await callTool('aviation_providers', {}, explorer);
  const fr24 = catalog.structuredContent.providers.find(({ id }) => id === 'flightradar24');
  assert.equal(fr24.exclusive, false);
  assert.equal(fr24.fr24_plan, 'explorer');
  assert.equal(fr24.fr24_endpoints.length, 17);
  const planAvailability = new Map(fr24.fr24_endpoints.map(({ id, available_on_plan }) => [id, available_on_plan]));
  assert.equal(planAvailability.get('airports_light'), true);

  const minuteAgo = Math.floor(Date.now() / 1000) - 60;
  const fortyDaysAgo = minuteAgo - 40 * 86_400;
  const explorerExcluded = [
    ['airports_full', { code: 'ICN' }],
    ['live_positions_count', { flights: 'KE703' }],
    ['historic_positions_count', { timestamp: minuteAgo, flights: 'KE703' }],
    ['historic_events_count', { flight_ids: testFlightId, event_types: 'all' }],
    ['flight_summary_count', { flight_ids: testFlightId }],
  ];
  for (const [selector] of explorerExcluded) assert.equal(planAvailability.get(selector), false, selector);

  const higherPlan = [
    ...explorerExcluded,
    ['live_positions_full', { flights: 'KE703', limit: 21 }],
    ['historic_positions_full', { timestamp: fortyDaysAgo, flights: 'KE703', limit: 1 }],
  ];

  for (const [fr24Endpoint, fr24Params] of higherPlan) {
    const args = { operation: 'fr24', fr24Endpoint, fr24Params, providers: ['flightradar24'] };
    const requestsBeforeExplorer = requests;
    const blocked = await lookupFr24(args, explorer);
    assert.equal(blocked.structuredContent.providers[0].status, 'unsupported_input', fr24Endpoint);
    assert.equal(requests, requestsBeforeExplorer, fr24Endpoint);

    const allowed = await lookupFr24(args, essential);
    assert.equal(allowed.structuredContent.providers[0].status, 'ok', fr24Endpoint);
    assert.equal(requests, requestsBeforeExplorer + 1, fr24Endpoint);
  }

  for (const [fr24Endpoint, fr24Params] of explorerExcluded) {
    const allowed = await lookupFr24({ operation: 'fr24', fr24Endpoint, fr24Params }, advanced);
    assert.equal(allowed.structuredContent.providers[0].status, 'ok', fr24Endpoint);
  }
  const extendedHistory = {
    operation: 'fr24', fr24Endpoint: 'historic_positions_light',
    fr24Params: { timestamp: minuteAgo - 800 * 86_400, flights: 'KE703', limit: 301 },
  };
  const limited = await lookupFr24(extendedHistory, essential);
  assert.equal(limited.structuredContent.providers[0].status, 'unsupported_input');
  const extended = await lookupFr24(extendedHistory, advanced);
  assert.equal(extended.structuredContent.providers[0].status, 'ok');
  const count = await lookupFr24({ operation: 'fr24', fr24Endpoint: 'live_positions_count', fr24Params: { flights: 'KE703' } }, advanced);
  assert.equal(count.structuredContent.providers[0].interval_ms, 300);
  const usage = await lookupFr24({ operation: 'fr24', fr24Endpoint: 'usage' }, advanced);
  assert.equal(usage.structuredContent.providers[0].interval_ms, 60_000);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

async function lookup(input, env) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aviation_lookup', arguments: input } }),
  }), env);
  return (await response.json()).result;
}

function mockUpstream(t, body = '{ "original": true }\n', contentType = 'application/json') {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), headers: new Headers(options.headers) });
    return new Response(body, { headers: { 'Content-Type': contentType } });
  });
  return requests;
}

test('AirLabs sends one exact identity, or uses its live schedule when airport filters are supplied', async (t) => {
  const requests = mockUpstream(t);
  const input = { operation: 'flight', providers: ['airlabs'], identType: 'icao', ident: 'KAL703' };
  const env = { AIRLABS_API_KEY: 'airlabs-fixture' };

  await lookup(input, env);
  assert.equal(requests[0].url.pathname, '/api/v9/flight');
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { api_key: 'airlabs-fixture', flight_icao: 'KAL703' });

  const result = await lookup({ ...input, airport: 'ICN', oppositeAirport: 'RJAA', direction: 'departure', limit: 4, page: 2 }, env);
  assert.equal(requests[1].url.pathname, '/api/v9/schedules');
  assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), {
    api_key: 'airlabs-fixture', flight_icao: 'KAL703', dep_iata: 'ICN', arr_icao: 'RJAA', limit: '4', offset: '4',
  });
  assert.match(result.structuredContent.providers[0].time_filter_note, /live schedule/);

  const context = await lookup({ ...input, airport: 'ICN' }, env);
  assert.equal(requests[2].url.pathname, requests[0].url.pathname);
  assert.equal(requests[2].url.search, requests[0].url.search);
  assert.match(context.structuredContent.providers[0].route_filter_note, /no arrival or departure role/);
});

test('Aviationstack sends an explicitly bounded live result set and omits default offset', async (t) => {
  const requests = mockUpstream(t);
  const input = { operation: 'airport', providers: ['aviationstack'], airport: 'ICN', oppositeAirport: 'NRT', direction: 'departure', limit: 5 };
  const env = { AVIATIONSTACK_API_KEY: 'aviationstack-fixture' };

  await lookup(input, env);
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), {
    access_key: 'aviationstack-fixture', dep_iata: 'ICN', arr_iata: 'NRT', limit: '5',
  });
  const skipped = await lookup({ ...input, cursor: 'opaque-cursor' }, env);
  assert.equal(skipped.structuredContent.providers[0].status, 'unsupported_input');
  assert.equal(requests.length, 1);

  const context = await lookup({
    operation: 'flight', providers: input.providers, airport: 'ICN', ident: 'KE703', identType: 'flight_number', limit: 5,
  }, env);
  assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), {
    access_key: 'aviationstack-fixture', flight_iata: 'KE703', limit: '5',
  });
  assert.match(context.structuredContent.providers[0].route_filter_note, /no arrival or departure role/);
});

test('FlightAware uses its documented single page and native non-stop route', async (t) => {
  const requests = mockUpstream(t);
  const env = { FLIGHTAWARE_API_KEY: 'flightaware-fixture' };
  const flight = { operation: 'flight', providers: ['flightaware'], identType: 'flight_number', ident: 'KE703', cursor: 'page=a+b' };

  await lookup(flight, env);
  assert.equal(requests[0].url.pathname, '/aeroapi/flights/KE703');
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { ident_type: 'designator', cursor: 'page=a+b' });

  const route = { operation: 'airport', providers: ['flightaware'], airport: 'ICN', oppositeAirport: 'NRT', direction: 'arrival' };
  await lookup(route, env);
  assert.equal(requests[1].url.pathname, '/aeroapi/airports/NRT/flights/to/ICN');
  assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), { connection: 'nonstop' });

  const skipped = await lookup({ ...route, date: '2026-11-25', fromTime: '06:00', toTime: '10:00' }, env);
  assert.match(skipped.structuredContent.providers[0].detail, /no documented arrival-time filter/);
  assert.equal(requests.length, 2);

  const timedRoute = await lookup({ ...route, direction: 'departure', date: '2026-11-25' }, env);
  assert.equal(requests[2].url.pathname, '/aeroapi/airports/ICN/flights/to/NRT');
  assert.deepEqual(Object.fromEntries(requests[2].url.searchParams), {
    start: '2026-11-24T15:00:00.000Z', end: '2026-11-25T15:00:00.000Z',
  });
  assert.match(timedRoute.structuredContent.providers[0].time_filter_note, /does not specify which flight timestamp/);
});

test('AeroDataBox requests location only for live queries and preserves native XML', async (t) => {
  const raw = '<flights>\n <flight />\n</flights>\n';
  const requests = mockUpstream(t, raw, 'application/xml');
  const env = { AERODATABOX_API_KEY: 'aerodatabox-fixture' };
  const input = { providers: ['aerodatabox'], identType: 'flight_number', ident: 'KE703', format: 'xml' };

  const result = await lookup({ ...input, operation: 'flight' }, env);
  const source = result.structuredContent.providers[0];
  assert.equal(requests[0].url.search, '');
  assert.equal(requests[0].headers.get('accept'), 'application/xml');
  assert.equal(result.content[source.raw_body_content_index].text, raw);

  await lookup({ ...input, operation: 'live' }, env);
  assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), { withLocation: 'true' });
});

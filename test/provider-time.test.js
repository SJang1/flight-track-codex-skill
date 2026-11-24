import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

async function lookup(arguments_, env) {
  const response = await worker.fetch(new Request('https://test.example/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aviation_lookup', arguments: arguments_ } }),
  }), env);
  return (await response.json()).result;
}

test('AirNav searches an airport-local window and sends directional UTC bounds and ICAO airport fields', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  const raw = '{ "cost": 0, "flights": [] }\n';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(raw);
  };
  const base = {
    operation: 'flight', providers: ['airnavradar'], airport: 'ICN', date: '2026-11-25',
    identType: 'flight_number', ident: 'FX5926', fromTime: '0600', toTime: '1000',
  };
  for (const [direction, airport] of [['arrival', 'toAirports'], ['departure', 'fromAirports']]) {
    const result = await lookup({ ...base, direction }, { AIRNAVRADAR_API_TOKEN: 'test-airnav-key' });
    const row = result.structuredContent.providers[0];
    assert.equal(row.status, 'ok');
    assert.equal(result.content[row.raw_body_content_index].text, raw);
    const { url, body } = calls.at(-1);
    assert.equal(url.pathname, '/v2/flights/search');
    assert.deepEqual(body[airport], ['RKSI']);
    assert.deepEqual(body.flightIds, ['FX5926']);
    assert.equal(body[`${direction}FromDate`], '2026-11-24T21:00:00.000Z');
    assert.equal(body[`${direction}ToDate`], '2026-11-25T01:00:00.000Z');
  }
  assert.equal(calls.length, 2);
});

test('AeroDataBox sends the airport wall-clock range and reports the exact flight endpoint limitation', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({ fixture: 'board' });
  };
  const env = { AERODATABOX_API_KEY: 'test-aerodatabox-key' };
  const options = { providers: ['aerodatabox'], airport: 'ICN', direction: 'arrival' };
  const range = { start: '2026-11-24T21:00:00Z', end: '2026-11-25T01:00:00Z' };
  const board = await lookup({ ...options, ...range, operation: 'airport' }, env);
  assert.equal(board.structuredContent.providers[0].status, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(decodeURIComponent(calls[0].pathname), '/flights/airports/iata/ICN/2026-11-25T06:00/2026-11-25T10:00');
  assert.equal(calls[0].searchParams.get('direction'), 'Arrival');

  const flight = await lookup({ ...options, ...range, operation: 'flight', identType: 'flight_number', ident: 'FX5926' }, env);
  const row = flight.structuredContent.providers[0];
  assert.equal(row.status, 'unsupported_input');
  assert.match(row.detail, /whole local dates/);
  assert.equal(row.upstream_attempted, false);
  assert.equal(calls.length, 1);
});

test('AeroDataBox exact flight numbers preserve the supported date and identify unused movement clocks', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  const raw = '{ "fixture": "flight status" }\n';
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(raw);
  };
  const base = {
    operation: 'flight', providers: ['aerodatabox'], airport: 'ICN', direction: 'arrival',
    fromTime: '0600', toTime: '1000',
  };
  for (const [identType, ident, date] of [
    ['flight_number', 'FX5926', '2026-11-25'], ['iata', 'FX5926'], ['icao', 'FDX5926'],
  ]) {
    const result = await lookup({ ...base, identType, ident, date }, { AERODATABOX_API_KEY: 'test-aerodatabox-key' });
    const row = result.structuredContent.providers[0];
    assert.equal(row.status, 'ok');
    assert.match(row.time_filter_note, date ? /selected local flight date/ : /nearest operating date/);
    assert.match(row.time_filter_note, /does not apply airport movement clock bounds/);
    assert.equal(result.content[row.raw_body_content_index].text, raw);
    const url = calls.at(-1);
    assert.equal(url.pathname, `/flights/number/${ident}${date ? `/${date}` : ''}`);
    assert.equal(url.searchParams.get('dateLocalRole'), 'Arrival');
    assert.doesNotMatch(url.href, /0600|1000/);
  }
  assert.equal(calls.length, 3);
});

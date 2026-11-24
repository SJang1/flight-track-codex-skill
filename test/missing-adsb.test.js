import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

async function lookup(input, env = {}) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aviation_lookup', arguments: input } }),
  }), env);
  return (await response.json()).result;
}

function mockUpstream(t, raw) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), headers: new Headers(options.headers) });
    return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

test('nearby aircraft use each provider radius path and native single-nearest variants', async (t) => {
  const raw = '{ "ac": [] }\n';
  const calls = mockUpstream(t, raw);
  const input = { operation: 'nearby', latitude: 37.46, longitude: 126.44, radiusNm: 25, providers: ['adsb_fi', 'adsb_lol', 'avioadsb'] };
  const env = { ADSB_LOL_API_KEY: 'adsb-fixture-key' };

  const nearby = await lookup(input, env);
  assert.deepEqual(calls.map(({ url }) => url.pathname).sort(), [
    '/api/v3/lat/37.46/lon/126.44/dist/25', '/v1/point/37.46/126.44/25', '/v2/point/37.46/126.44/25',
  ]);
  assert.equal(calls.find(({ url }) => url.hostname === 'api.adsb.lol').headers.get('X-API-Key'), 'adsb-fixture-key');
  for (const row of nearby.structuredContent.providers) {
    assert.equal(row.status, 'ok');
    assert.equal(nearby.content[row.raw_body_content_index].text, raw);
  }

  const nearest = await lookup({ ...input, limit: 1 }, env);
  assert.deepEqual(calls.slice(3).map(({ url }) => url.pathname).sort(), [
    '/v1/closest/37.46/126.44/25', '/v2/closest/37.46/126.44/25',
  ]);
  assert.match(nearest.structuredContent.providers.find(({ provider }) => provider === 'adsb_fi').detail, /do not accept a result limit/);

  const outside = await lookup({ ...input, providers: ['avioadsb'], radiusNm: 101 });
  assert.match(outside.structuredContent.providers[0].detail, /up to 100 nautical miles/);
  const fractional = await lookup({ ...input, providers: ['adsb_lol'], radiusNm: 25.5 }, env);
  assert.match(fractional.structuredContent.providers[0].detail, /whole nautical miles/);
  const missingKey = await lookup({ ...input, providers: ['adsb_lol'] });
  assert.equal(missingKey.structuredContent.providers[0].status, 'missing_credentials');
  assert.equal(calls.length, 5);
});

test('adsb.lol recent trace is opt-in and preserves the unchanged default full trace', async (t) => {
  const raw = '{ "icao": "4ca87c", "trace": [] }\n';
  const calls = mockUpstream(t, raw);
  const input = { operation: 'track', identType: 'icao24', ident: '4CA87C', providers: ['adsb_lol'] };
  const env = { ADSB_LOL_API_KEY: 'fixture-key' };
  const latest = await lookup({ ...input, trackScope: 'recent' }, env);
  const full = await lookup(input, env);
  assert.deepEqual(calls.map(({ url }) => url.pathname), ['/1/trace/recent/4ca87c', '/1/trace/full/4ca87c']);
  assert.match(latest.structuredContent.providers[0].time_filter_note, /tail/);
  assert.match(full.structuredContent.providers[0].time_filter_note, /daily trace/);
  for (const result of [latest, full]) {
    const source = result.structuredContent.providers[0];
    assert.equal(source.status, 'ok');
    assert.equal(result.content[source.raw_body_content_index].text, raw);
  }
  const unsupported = await lookup({ ...input, trackScope: 'recent', providers: ['adsb_aero'] }, env);
  assert.equal(unsupported.structuredContent.providers[0].status, 'unsupported_input');
  assert.equal(calls.length, 2);

  const archiveId = '4ca87c:2026-11-24T12:00:00Z';
  const archived = await lookup({ ...input, identType: 'provider_id', ident: archiveId, trackScope: 'full', providers: ['adsb_aero'] });
  assert.equal(calls[2].url.pathname, `/api/v1/flights/${encodeURIComponent(archiveId)}`);
  assert.equal(archived.structuredContent.providers[0].status, 'ok');
});

test('extended AvioADSB observation and selected airport references return upstream bytes', async (t) => {
  const raw = '{ "native": true }\n';
  const calls = mockUpstream(t, raw);

  const aircraft = await lookup({ operation: 'aircraft', identType: 'icao24', ident: '4CA2D5', providers: ['avioadsb'] });
  assert.equal(calls[0].url.pathname, '/v1/extended/4ca2d5');
  const observation = aircraft.structuredContent.providers[0];
  assert.match(observation.time_filter_note, /extended live observation/);
  assert.equal(aircraft.content[observation.raw_body_content_index].text, raw);

  const airports = await lookup({ operation: 'airport_info', airport: 'EGHP', providers: ['adsb_aero', 'adsb_lol'] }, { ADSB_LOL_API_KEY: 'airport-key' });
  assert.deepEqual(calls.slice(1).map(({ url }) => url.pathname).sort(), ['/api/0/airport/EGHP', '/api/v1/airports/EGHP']);
  for (const source of airports.structuredContent.providers) {
    assert.equal(source.status, 'ok');
    assert.equal(airports.content[source.raw_body_content_index].text, raw);
  }
  const skipped = await lookup({ operation: 'airport_info', airport: 'EGHP', providers: ['adsb_lol'] });
  assert.equal(skipped.structuredContent.providers[0].status, 'missing_credentials');
  assert.equal(calls.length, 3);
});

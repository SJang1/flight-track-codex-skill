import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import { airportDataProvider } from '../src/airport-data-provider.js';
import { trackingProviders } from '../src/tracking-providers.js';

const raw = '{ "fixture": true }\n';

async function lookup(nativeProvider, nativeEndpoint, nativeParams, env = {}, nativeBody) {
  const response = await worker.fetch(new Request('https://worker.test/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'aviation_native_lookup', arguments: { nativeProvider, nativeEndpoint, nativeParams, nativeBody },
    } }),
  }), env);
  return (await response.json()).result;
}

function mockUpstream(t) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const address = new URL(url);
    requests.push({ address, method: options.method, headers: new Headers(options.headers), body: options.body });
    if (address.hostname === 'auth.opensky-network.org') return Response.json({ access_token: 'fixture-oauth-token' });
    return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
  });
  return requests;
}

function source(result) {
  assert.ok(result?.structuredContent, JSON.stringify(result));
  return result.structuredContent.providers[0];
}

test('Native catalogs reflect the documented finite HTTP coverage of ADS-B and FreeAirportDB', () => {
  const providers = new Map([...trackingProviders, airportDataProvider].map((provider) => [provider.id, provider]));
  const expected = { adsb_fi: 7, adsb_lol: 20, avioadsb: 15, adsb_aero: 9, opensky: 7, freeairportdb: 3 };
  for (const [id, count] of Object.entries(expected)) {
    const endpoints = providers.get(id).native.endpoints;
    assert.equal(endpoints.length, count, id);
    assert.equal(new Set(endpoints.map(({ method, path }) => `${method} ${path}`)).size, count, id);
  }
});

test('Native ADS-B filters, read-only routes and contributor restrictions map without fan-out', async (t) => {
  const requests = mockUpstream(t);
  const squawk = await lookup('adsb_fi', 'squawk', { squawk: '0042' });
  assert.equal(requests[0].address.pathname, '/api/v2/sqk/0042');
  assert.equal(squawk.content[source(squawk).raw_body_content_index].text, raw);
  const noLolKey = await lookup('adsb_lol', 'type', { aircraft_type: 'A320' });
  assert.equal(source(noLolKey).status, 'missing_credentials');
  assert.equal(requests.length, 1);

  const aircraft = { callsign: 'ABC42', lat: 33.4, lng: 126.5 };
  const routes = await lookup('adsb_lol', 'routeset', {}, { ADSB_LOL_API_KEY: 'fixture-lol' }, { planes: [aircraft] });
  assert.equal(requests[1].address.pathname, '/api/0/routeset');
  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].headers.get('X-API-Key'), 'fixture-lol');
  assert.deepEqual(JSON.parse(requests[1].body), { planes: [aircraft] });
  assert.equal(routes.content[source(routes).raw_body_content_index].text, raw);
  assert.equal(source(routes).recommended_next_at, null);

  const datalink = await lookup('avioadsb', 'acars', { hex: 'a0b1c2', type: 'vdl2,hfdl', adsc: false, after: 0 });
  assert.equal(source(datalink).status, 'ok');
  assert.equal(requests[2].address.pathname, '/v1/acars');
  assert.deepEqual(Object.fromEntries(requests[2].address.searchParams), { hex: 'a0b1c2', type: 'vdl2,hfdl', adsc: 'false', after: '0' });
  assert.equal(requests[2].headers.get('X-API-Key'), null);

  assert.equal(source(await lookup('avioadsb', 'aircraft', { bbox: '30,120,40,130' })).status, 'missing_credentials');
  assert.equal(source(await lookup('avioadsb', 'adsc', { limit: 51 })).status, 'unsupported_input');
  assert.equal(requests.length, 3);
});

test('Native adsb.lol map redirect reports the upstream Location without following it', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([new URL(url).pathname, options.redirect]);
    return new Response(null, { status: 307, headers: { Location: 'https://www.adsb.lol/map?example=fixture-lol' } });
  });
  const result = await lookup('adsb_lol', 'map_redirect', {}, { ADSB_LOL_API_KEY: 'fixture-lol' });
  assert.deepEqual(calls, [['/0/my', 'manual']]);
  assert.equal(source(result).http_status, 307);
  assert.equal(source(result).redirect_location, 'https://www.adsb.lol/map?example=[REDACTED]');
});

test('Native adsb.aero search preserves the predicate JSON and FreeAirportDB preserves geometry and paging', async (t) => {
  const requests = mockUpstream(t);
  const query = {
    match: { and: [
      { icao_type: ['A320'] },
      { endpoint_within: { mode: 'end', geometry: { type: 'Circle', coordinates: [126.44, 37.46], radius: 6000 } } },
    ] },
    limit: 10, include_path: false,
  };
  assert.equal(source(await lookup('adsb_aero', 'query_flights', {}, {}, query)).status, 'ok');
  assert.equal(requests[0].address.pathname, '/api/v1/query');
  assert.deepEqual(JSON.parse(requests[0].body), query);
  assert.equal(source(await lookup('freeairportdb', 'search', { q: 'Incheon', country: 'KR', limit: 5, offset: 0 })).status, 'ok');
  assert.equal(requests[1].address.pathname, '/v1/airports');
  assert.equal(requests[1].address.searchParams.get('offset'), '0');
  assert.equal(source(await lookup('freeairportdb', 'nearby', { lat: 37.46, lng: 126.44, radius: 15.5 })).status, 'ok');
  assert.equal(requests[2].address.pathname, '/v1/airports/nearby');
  assert.equal(requests[2].address.searchParams.get('radius'), '15.5');
});

test('Native OpenSky vector selectors repeat ids while flights_all enforces its two-hour window', async (t) => {
  const requests = mockUpstream(t);
  const env = { OPENSKY_CLIENT_ID: 'fixture-client-id', OPENSKY_CLIENT_SECRET: 'fixture-credential' };
  const result = await lookup('opensky', 'states_own', { icao24: ['ABC123', 'DEF456'], serials: [10001, 10002], extended: 1 }, env);
  assert.equal(requests[1].address.pathname, '/api/states/own');
  assert.deepEqual(requests[1].address.searchParams.getAll('icao24'), ['abc123', 'def456']);
  assert.deepEqual(requests[1].address.searchParams.getAll('serials'), ['10001', '10002']);
  assert.equal(requests[1].headers.get('Authorization'), 'Bearer fixture-oauth-token');
  assert.equal(result.content[source(result).raw_body_content_index].text, raw);
  assert.equal(source(result).recommended_next_at, null);

  const latest = await lookup('opensky', 'flights_all', { begin: 1600000000, end: 1600007200 }, env);
  assert.equal(source(latest).status, 'ok');
  assert.equal(requests[3].address.pathname, '/api/flights/all');
  assert.equal(source(await lookup('opensky', 'flights_all', { begin: 1600000000, end: 1600007201 }, env)).status, 'unsupported_input');
  assert.equal(requests.length, 4);
});

test('OpenSky uses anonymous current state vectors when OAuth is absent', async (t) => {
  const requests = mockUpstream(t);
  const result = await lookup('opensky', 'states_all', { icao24: ['ABC123'] });
  assert.equal(source(result).status, 'ok');
  assert.equal(source(result).interval_ms, 864_000);
  assert.equal(requests[0].address.pathname, '/api/states/all');
  assert.equal(requests[0].headers.get('Authorization'), null);
  const archived = await lookup('opensky', 'states_all', { icao24: ['ABC123'], time: 1600000000 });
  assert.equal(source(archived).status, 'missing_credentials');
  assert.equal(requests.length, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

const raw = '{ "fixture": [] }\n';

async function lookup(args, env = {}) {
  const response = await worker.fetch(new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aviation_lookup', arguments: args } }),
  }), env);
  return (await response.json()).result;
}

test('Live ADS-B keeps one native identifier in each path and rejects movement and paging predicates', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    calls.push({ url: new URL(address), headers: options.headers });
    return new Response(raw);
  });
  const live = { operation: 'live', identType: 'registration', ident: 'HL7753', airport: 'ICN', providers: ['adsb_fi', 'adsb_lol', 'avioadsb'] };
  const env = { ADSB_LOL_API_KEY: 'fixture-lol', AVIOADSB_API_KEY: 'fixture-avio' };
  const result = await lookup(live, env);

  assert.deepEqual(Object.fromEntries(calls.map(({ url }) => [url.hostname, url.pathname + url.search])), {
    'opendata.adsb.fi': '/api/v2/registration/HL7753',
    'api.adsb.lol': '/v2/reg/HL7753',
    'avioadsb.org': '/v1/reg/HL7753',
  });
  assert.equal(calls.find(({ url }) => url.hostname === 'api.adsb.lol').headers['X-API-Key'], env.ADSB_LOL_API_KEY);
  for (const source of result.structuredContent.providers) {
    assert.match(source.route_filter_note, /airport code is context/);
    assert.equal(result.content[source.raw_body_content_index].text, raw);
  }

  for (const unsupported of [{ direction: 'arrival' }, { page: 2 }, { cursor: 'elsewhere' }, { limit: 1 }]) {
    const skipped = await lookup({ ...live, ...unsupported }, env);
    assert.equal(skipped.structuredContent.providers.length, 3);
    for (const source of skipped.structuredContent.providers) {
      assert.equal(source.status, 'unsupported_input');
      assert.equal(source.upstream_attempted, false);
    }
  }
  assert.equal(calls.length, 3);
});

test('OpenSky requests current state without a timestamp, or one explicit recent snapshot', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-25T03:00:00Z'));
  const requests = [];
  let oauthCount = 0;
  t.mock.method(globalThis, 'fetch', async (address) => {
    const url = new URL(address);
    if (url.hostname === 'auth.opensky-network.org') {
      oauthCount += 1;
      return Response.json({ access_token: 'fixture-token' });
    }
    requests.push(url.pathname + url.search);
    return new Response(raw);
  });
  const env = { OPENSKY_CLIENT_ID: 'fixture-client', OPENSKY_CLIENT_SECRET: 'fixture-secret' };
  const aircraft = { identType: 'icao24', ident: 'ABC123', providers: ['opensky'] };
  const start = '2026-11-25T02:30:25Z';
  const time = Date.parse(start) / 1000;
  const live = await lookup({ ...aircraft, operation: 'live' }, env);
  const snapshot = await lookup({ ...aircraft, operation: 'live', start }, env);
  const track = await lookup({ ...aircraft, operation: 'track', start }, env);
  assert.deepEqual(requests, [
    '/api/states/all?icao24=abc123',
    `/api/states/all?icao24=abc123&time=${time}`,
    `/api/tracks/all?icao24=abc123&time=${time}`,
  ]);
  assert.equal(snapshot.structuredContent.providers[0].time_filter_basis, 'state_vector_time');
  for (const result of [live, snapshot, track]) {
    const source = result.structuredContent.providers[0];
    assert.equal(result.content[source.raw_body_content_index].text, raw);
  }

  for (const intent of [
    { operation: 'live', start: '2026-11-25T01:59:59Z' },
    { operation: 'live', start, end: '2026-11-25T02:40:00Z' },
    { operation: 'live', identType: 'callsign' },
    { operation: 'track', date: '2026-11-25' },
    { operation: 'track', start: '2026-10-24T12:00:00Z' },
  ]) {
    const { structuredContent } = await lookup({ ...aircraft, ...intent }, env);
    const [source] = structuredContent.providers;
    assert.equal(source.status, 'unsupported_input');
    assert.equal(source.upstream_attempted, false);
  }
  assert.equal(oauthCount, 3);
});

test('adsb.aero uses an opaque cursor and exact time bounds without asking for trajectories', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    calls.push({ path: new URL(address).pathname, body: JSON.parse(options.body) });
    return new Response(raw);
  });
  const archived = {
    operation: 'history', identType: 'callsign', ident: 'KAL703', providers: ['adsb_aero'],
    start: '2026-11-24T01:00:00Z', end: '2026-11-24T04:00:00Z', limit: 6, cursor: 'provider-value',
  };
  const result = await lookup(archived);
  const [source] = result.structuredContent.providers;
  assert.equal(source.time_filter_basis, 'start_ts');
  assert.match(source.identity_filter_note, /by prefix/);
  assert.equal(result.content[source.raw_body_content_index].text, raw);
  assert.deepEqual(calls, [{
    path: '/api/v1/query',
    body: {
      match: { callsign_prefix: 'KAL703' },
      start_from: '2026-11-24T01:00:00.000Z',
      end_date: '2026-11-24T04:00:00.000Z',
      limit: 6,
      cursor: 'provider-value',
      include_path: false,
    },
  }]);
  const skipped = await lookup({ ...archived, page: 2 });
  assert.match(skipped.structuredContent.providers[0].detail, /cursor without a page number/);
  assert.equal(calls.length, 1);
});

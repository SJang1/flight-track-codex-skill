import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';
import { airLabsNative } from '../src/airlabs-endpoints.js';
import { aviationstackNative } from '../src/aviationstack-endpoints.js';

const env = { AIRLABS_API_KEY: 'airlabs-key-fixture', AVIATIONSTACK_API_KEY: 'aviationstack-key-fixture' };

async function native(nativeProvider, nativeEndpoint, nativeParams, { format, manage, env: credentials = env } = {}) {
  const name = manage ? 'aviation_native_manage' : 'aviation_native_lookup';
  const result = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name, arguments: { nativeProvider, nativeEndpoint, nativeParams, format },
    } }),
  }), credentials);
  return (await result.json()).result;
}

const airLabsSample = {
  flight: { flight_iata: 'KE703' }, historical: { flight_icao: 'KAL703', offset: 0 },
  schedules: { dep_icao: 'RKSI' }, delays: { delay: 40, type: 'departures' }, routes: { arr_iata: 'ICN' },
  nearby: { lat: 0, lng: 0, distance: 20 }, suggest: { s: 'Seoul' },
  listen: { webhook_url: 'https://receiver.example/hook', flight_number: '703' }, unlisten: { listener_id: 12 },
};

const stackSample = {
  flights: { dep_icao: 'RKSI', min_delay_dep: 0 },
  timetable: { iataCode: 'ICN', type: 'departure', offset: 0, limit: 4 },
  flightsFuture: { iataCode: 'ICN', type: 'arrival', date: '2026-12-01', flight_number: '703', limit: 2 },
  aircraft_types: { search: 'Boeing', limit: 20 },
};

test('AirLabs and Aviationstack native catalogs dispatch all documented operations with one upstream request each', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-24T22:00:00Z'));
  const requests = [];
  const raw = '{ "upstream": true }\n';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url: new URL(url), method: init.method });
    return new Response(raw);
  });

  assert.equal(airLabsNative.endpoints.length, 20);
  assert.equal(aviationstackNative.endpoints.length, 11);
  assert.deepEqual(airLabsNative.endpoints.filter(({ mutates }) => mutates).map(({ id }) => id), ['listen', 'unlisten']);
  for (const [provider, definition, sample, auth] of [
    ['airlabs', airLabsNative, airLabsSample, 'api_key'],
    ['aviationstack', aviationstackNative, stackSample, 'access_key'],
  ]) {
    for (const endpoint of definition.endpoints) {
      const count = requests.length;
      const params = sample[endpoint.id] ?? {};
      const format = endpoint.id === 'nearby' ? 'xml' : endpoint.id === 'airlines' && provider === 'airlabs' ? 'csv' : undefined;
      const result = await native(provider, endpoint.id, params, { format, manage: endpoint.mutates });
      assert.equal(requests.length, count + 1, `${provider}/${endpoint.id}: ${JSON.stringify(result)}`);
      const { url, method } = requests[count];
      assert.equal(method, 'GET');
      assert.equal(`${url.origin}${url.pathname}`, `${endpoint.baseUrl ?? definition.baseUrl}${endpoint.path}${format ? `.${format}` : ''}`);
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
        [auth]: env[provider === 'airlabs' ? 'AIRLABS_API_KEY' : 'AVIATIONSTACK_API_KEY'],
      });
      const row = result.structuredContent.providers[0];
      assert.equal(result.content[row.raw_body_content_index].text, raw);
    }
  }
});

test('AirLabs alert changes and native credential or endpoint failures do not reach a provider', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const attempts = await Promise.all([
    native('airlabs', 'listen', airLabsSample.listen),
    native('airlabs', 'unlisten', airLabsSample.unlisten),
    native('airlabs', 'listen', { webhook_url: 'ftp://example.test/hook' }, { manage: true }),
    native('airlabs', 'historical', airLabsSample.historical, { format: 'xml' }),
    native('aviationstack', 'flight_schedules', { iataCode: 'ICN', type: 'departure' }),
    native('aviationstack', 'airports', {}, { env: {} }),
  ]);
  for (const item of attempts) assert.ok(item?.isError || item?.structuredContent?.providers?.[0].status !== 'ok');
  assert.equal(fetch.mock.callCount(), 0);
});

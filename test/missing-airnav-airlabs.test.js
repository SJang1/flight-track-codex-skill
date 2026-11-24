import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

async function lookup(arguments_, env) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aviation_lookup', arguments: arguments_ } }),
  }), env);
  return (await response.json()).result;
}

function capture(t) {
  const raw = '{ "source": "original" }\n';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), method: options.method, body: options.body && JSON.parse(options.body) });
    return new Response(raw);
  });
  return { raw, requests };
}

test('AirNav uses a bounded path search, upcoming schedule, and exact reference routes', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-25T01:00:00Z'));
  const { raw, requests } = capture(t);
  const env = { AIRNAVRADAR_API_TOKEN: 'test-airnav-api' };
  const providers = ['airnavradar'];
  const track = await lookup({ operation: 'track', providers, identType: 'icao24', ident: 'ABC123', date: '2026-11-24' }, env);
  assert.equal(requests[0].url.pathname, '/v2/flights/search');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url.searchParams.get('pageSize'), '1');
  assert.deepEqual(requests[0].body, {
    modeSHexCodes: ['ABC123'], fromDate: '2026-11-24T00:00:00.000Z', toDate: '2026-11-24T23:59:59.999Z', includeFlightPaths: true,
  });
  assert.equal(track.content[track.structuredContent.providers[0].raw_body_content_index].text, raw);

  await lookup({ operation: 'schedule', providers, identType: 'iata', ident: 'KE703', airport: 'ICN', direction: 'departure', date: '2026-11-26' }, env);
  assert.equal(requests[1].url.pathname, '/v2/flights/schedules');
  assert.deepEqual(Object.fromEntries(requests[1].url.searchParams), {
    flightId: 'KE703', fromAirport: 'ICN', departureFromDate: '2026-11-25T15:00:00Z', departureToDate: '2026-11-26T14:59:59Z',
  });
  await lookup({ operation: 'aircraft', providers, identType: 'registration', ident: 'HL8008' }, env);
  assert.equal(requests[2].url.pathname, '/v2/aircraft');
  assert.deepEqual(Object.fromEntries(requests[2].url.searchParams), { registration: 'HL8008' });
  await lookup({ operation: 'airport_info', providers, airport: 'ICN' }, env);
  assert.equal(requests[3].url.pathname, '/v2/airports/ICN');
  assert.equal(requests.length, 4);
});

test('AirLabs routes exact aircraft, live, history, airport and airline lookups separately', async (t) => {
  const { requests } = capture(t);
  const env = { AIRLABS_API_KEY: 'test-airlabs-api' };
  const providers = ['airlabs'];
  const checks = [
    [{ operation: 'aircraft', identType: 'registration', ident: 'HL8008' }, '/api/v9/fleets', { reg_number: 'HL8008', limit: '1' }],
    [{ operation: 'live', identType: 'icao24', ident: 'ABC123' }, '/api/v9/flights', { hex: 'ABC123' }],
    [{ operation: 'history', identType: 'iata', ident: 'KE703', cursor: '10' }, '/api/v10/historical', { flight_iata: 'KE703', offset: '10' }],
    [{ operation: 'airport_info', airport: 'ICN' }, '/api/v9/airports', { iata_code: 'ICN' }],
    [{ operation: 'airline_info', identType: 'icao', ident: 'KAL' }, '/api/v9/airlines', { icao_code: 'KAL' }],
  ];
  for (const [input, path, query] of checks) {
    const result = await lookup({ ...input, providers }, env);
    assert.equal(result.structuredContent.providers[0].status, 'ok');
    const { url } = requests.at(-1);
    assert.equal(url.pathname, path);
    assert.deepEqual(Object.fromEntries(url.searchParams), { api_key: 'test-airlabs-api', ...query });
  }
  const wrongWindow = await lookup({ ...checks[2][0], providers, date: '2026-11-24' }, env);
  assert.equal(wrongWindow.structuredContent.providers[0].upstream_attempted, false);
  assert.equal(requests.length, checks.length);
});

test('provider IDs require their issuer and airport reference requests do not fan out to status endpoints', async (t) => {
  const { requests } = capture(t);
  const id = { operation: 'track', identType: 'provider_id', ident: '333ca4a2' };
  const env = { FLIGHTRADAR24_API_KEY: 'test-fr24' };
  assert.equal((await lookup(id, env)).isError, true);
  assert.equal((await lookup({ ...id, providers: ['flightradar24', 'airnavradar'] }, env)).isError, true);
  assert.equal(requests.length, 0);
  await lookup({ ...id, providers: ['flightradar24'] }, env);
  assert.equal(requests[0].url.pathname, '/api/flight-tracks');
  const airport = await lookup({ operation: 'airport_info', airport: 'ICN', providers: ['freeairportdb'] }, env);
  assert.equal(airport.structuredContent.providers[0].result_kind, 'airport_info');
  assert.equal(requests[1].url.pathname, '/v1/airports/ICN');
  assert.equal(requests.length, 2);
});

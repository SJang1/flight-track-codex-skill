import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

async function lookup(input, env = { AVIATIONSTACK_API_KEY: 'aviationstack-fixture' }) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'aviation_lookup', arguments: { ...input, providers: ['aviationstack'] },
    } }),
  }), env);
  return (await response.json()).result;
}

test('Aviationstack history and schedule use their own date parameters and preserve the native body', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-24T22:00:00Z'));
  const requests = [];
  const raw = '{ "data": [] }\n';
  t.mock.method(globalThis, 'fetch', async (value) => {
    requests.push(new URL(value));
    return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
  });

  const history = { operation: 'history', identType: 'flight_number', ident: 'KE703', date: '2026-11-24',
    airport: 'ICN', oppositeAirport: 'NRT', direction: 'departure', page: 2, limit: 5 };
  const schedule = { operation: 'schedule', airport: 'ICN', direction: 'arrival', date: '2026-11-26' };
  const historyResult = await lookup(history);
  const scheduleResult = await lookup(schedule);

  assert.equal(requests[0].origin, 'https://api.apilayer.net');
  assert.equal(requests[0].pathname, '/aviationstack/v1/flights');
  assert.deepEqual(Object.fromEntries(requests[0].searchParams), {
    access_key: 'aviationstack-fixture', flight_date: '2026-11-24', flight_iata: 'KE703', dep_iata: 'ICN', arr_iata: 'NRT', limit: '5', offset: '5',
  });
  assert.equal(requests[1].pathname, '/aviationstack/v1/flightsFuture');
  assert.deepEqual(Object.fromEntries(requests[1].searchParams), {
    access_key: 'aviationstack-fixture', iataCode: 'ICN', type: 'arrival', date: '2026-11-26',
  });
  for (const result of [historyResult, scheduleResult]) {
    const source = result.structuredContent.providers[0];
    assert.equal(source.status, 'ok');
    assert.equal(result.content[source.raw_body_content_index].text, raw);
  }

  for (const input of [
    { ...history, fromTime: '0600', toTime: '1000' },
    { ...schedule, ident: 'KE703', identType: 'flight_number' },
    { ...schedule, date: '2026-11-25' },
    { ...schedule, limit: 3 },
  ]) {
    const skipped = await lookup(input);
    assert.equal(skipped.structuredContent.providers[0].status, 'unsupported_input');
  }
  const missing = await lookup(schedule, {});
  assert.equal(missing.structuredContent.providers[0].status, 'missing_credentials');
  assert.equal(requests.length, 2);
});

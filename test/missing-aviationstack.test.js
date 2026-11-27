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

  const timetable = await lookup({ ...schedule, date: '2026-11-25', ident: 'KE703', identType: 'flight_number', page: 2, limit: 5 });
  assert.equal(timetable.structuredContent.providers[0].status, 'ok');
  assert.equal(requests[2].pathname, '/aviationstack/v1/timetable');
  assert.deepEqual(Object.fromEntries(requests[2].searchParams), {
    access_key: 'aviationstack-fixture', iataCode: 'ICN', type: 'arrival', flight_iata: 'KE703', limit: '5', offset: '5',
  });

  const future = await lookup({ ...schedule, ident: 'KAL703', identType: 'icao', page: 2, limit: 3 });
  assert.equal(future.structuredContent.providers[0].status, 'ok');
  assert.equal(requests[3].pathname, '/aviationstack/v1/flightsFuture');
  assert.deepEqual(Object.fromEntries(requests[3].searchParams), {
    access_key: 'aviationstack-fixture', iataCode: 'ICN', type: 'arrival', date: '2026-11-26',
    airline_icao: 'KAL', flight_number: '703', limit: '3', offset: '3',
  });

  const live = await lookup({ operation: 'live', ident: 'KE703', identType: 'iata', airport: 'RKSI', oppositeAirport: 'RJAA', direction: 'departure' });
  assert.equal(live.structuredContent.providers[0].status, 'ok');
  assert.equal(requests[4].pathname, '/aviationstack/v1/flights');
  assert.deepEqual(Object.fromEntries(requests[4].searchParams), {
    access_key: 'aviationstack-fixture', flight_status: 'active', flight_iata: 'KE703', dep_icao: 'RKSI', arr_icao: 'RJAA', limit: '10',
  });

  for (const input of [
    { ...history, fromTime: '0600', toTime: '1000' },
    { ...schedule, oppositeAirport: 'NRT' },
    { ...schedule, date: '2026-11-24' },
    { ...schedule, date: '2027-12-01' },
    { operation: 'live', ident: 'KE703', identType: 'iata', date: '2026-11-25' },
  ]) {
    const skipped = await lookup(input);
    assert.equal(skipped.structuredContent.providers[0].status, 'unsupported_input');
  }
  const missing = await lookup(schedule, {});
  assert.equal(missing.structuredContent.providers[0].status, 'missing_credentials');
  assert.equal(requests.length, 5);
});

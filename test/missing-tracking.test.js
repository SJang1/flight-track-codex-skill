import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

async function lookup(args, env) {
  const response = await worker.fetch(new Request('https://site.test/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'aviation_lookup', arguments: args } }),
  }), env);
  return (await response.json()).result;
}

function fixture(t) {
  const requested = [];
  const original = '{ "origin": "fixture" }\n';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requested.push({ url: new URL(url), headers: new Headers(options.headers) });
    return new Response(original);
  });
  return { requested, original };
}

function matched(result, provider) {
  return result.structuredContent.providers.find((entry) => entry.provider === provider);
}

test('AeroDataBox reference paths use one identifier and preserve the raw body', async (t) => {
  const { requested, original } = fixture(t);
  const env = { AERODATABOX_API_KEY: 'adb-fixture' };
  const providers = ['aerodatabox'];
  const cases = [
    [{ operation: 'aircraft', identType: 'icao24', ident: '484161' }, '/aircrafts/icao24/484161'],
    [{ operation: 'aircraft', identType: 'provider_id', ident: '12345' }, '/aircrafts/id/12345'],
    [{ operation: 'aircraft_registrations', identType: 'registration', ident: 'PH-BXO', format: 'xml' }, '/aircrafts/reg/PH-BXO/registrations'],
    [{ operation: 'airport_info', airport: 'ICN' }, '/airports/iata/ICN'],
    [{ operation: 'airport_runways', airport: 'RKSI' }, '/airports/icao/RKSI/runways'],
  ];
  for (const [args, path] of cases) {
    const result = await lookup({ ...args, providers }, env);
    const row = matched(result, 'aerodatabox');
    assert.equal(row.status, 'ok');
    assert.equal(result.content[row.raw_body_content_index].text, original);
    const request = requested.at(-1);
    assert.equal(request.url.pathname, path);
    assert.equal(request.url.search, '');
    if (args.format === 'xml') assert.equal(request.headers.get('accept'), 'application/xml');
  }
  const noKey = await lookup({ ...cases[0][0], providers }, {});
  assert.equal(matched(noKey, 'aerodatabox').status, 'missing_credentials');
  assert.equal(requested.length, cases.length);
});

test('AeroDataBox uses the existing FIDS and dated flight paths for historical boards and schedules', async (t) => {
  const { requested } = fixture(t);
  const providers = ['aerodatabox'];
  const env = { AERODATABOX_API_KEY: 'adb-fixture' };
  await lookup({ operation: 'history', providers, airport: 'ICN', direction: 'arrival', date: '2026-11-23', fromTime: '0600', toTime: '1000' }, env);
  assert.equal(decodeURIComponent(requested[0].url.pathname), '/flights/airports/iata/ICN/2026-11-23T06:00/2026-11-23T10:00');
  assert.equal(requested[0].url.searchParams.get('direction'), 'Arrival');

  const flight = { providers, identType: 'flight_number', ident: 'KE703', date: '2026-11-25' };
  await lookup({ ...flight, operation: 'schedule' }, env);
  const filed = await lookup({ ...flight, operation: 'filed_route' }, env);
  assert.equal(requested[1].url.pathname, '/flights/number/KE703/2026-11-25');
  assert.equal(requested[1].url.search, '');
  assert.equal(requested[2].url.pathname, requested[1].url.pathname);
  assert.deepEqual(Object.fromEntries(requested[2].url.searchParams), { withFlightPlan: 'true' });
  assert.match(matched(filed, 'aerodatabox').route_filter_note, /filed flight plan/);
  assert.equal(requested.length, 3);
});

test('AeroDataBox departure-date lookup sends the native bounded dates-only path', async (t) => {
  const { requested } = fixture(t);
  const env = { AERODATABOX_API_KEY: 'adb-fixture' };
  const input = {
    operation: 'flight_dates', providers: ['aerodatabox'], identType: 'flight_number', ident: 'KE703',
    fromDate: '2026-11-23', toDate: '2026-11-25',
  };
  const dates = await lookup(input, env);
  assert.equal(matched(dates, 'aerodatabox').time_filter_basis, 'local_departure_date');
  assert.equal(requested[0].url.pathname, '/flights/number/KE703/dates/2026-11-23/2026-11-25');
  assert.equal(requested[0].url.search, '');
  assert.equal(requested.length, 1);
});

test('FlightAware uses distinct endpoints for reference data, filed routes, and actual tracks', async (t) => {
  const { requested } = fixture(t);
  const providers = ['flightaware'];
  const env = { FLIGHTAWARE_API_KEY: 'fa-fixture', FLIGHTAWARE_HISTORY: 'true' };
  const flight = { identType: 'provider_id', ident: 'KAL703-1737309600-airline-0000' };
  const cases = [
    [{ operation: 'aircraft', identType: 'aircraft_type', ident: 'B77W' }, '/aircraft/types/B77W'],
    [{ operation: 'airport_info', airport: 'ICN' }, '/airports/ICN'],
    [{ operation: 'airline_info', identType: 'icao', ident: 'KAL' }, '/operators/KAL'],
    [{ operation: 'last_flight', identType: 'registration', ident: 'HL8008' }, '/history/aircraft/HL8008/last_flight'],
    [{ ...flight, operation: 'track' }, `/flights/${flight.ident}/track`],
    [{ ...flight, operation: 'filed_route' }, `/flights/${flight.ident}/route`],
    [{ ...flight, operation: 'filed_route', date: '2025-01-20' }, `/history/flights/${flight.ident}/route`],
  ];
  for (const [args, path] of cases) {
    const result = await lookup({ ...args, providers }, env);
    assert.equal(matched(result, 'flightaware').status, 'ok');
    assert.equal(requested.at(-1).url.pathname, `/aeroapi${path}`);
    assert.equal(requested.at(-1).url.search, '');
    assert.equal(requested.at(-1).headers.get('x-apikey'), 'fa-fixture');
  }
  const unsupported = await lookup({ ...cases[3][0], providers }, { FLIGHTAWARE_API_KEY: 'fa-fixture' });
  assert.match(matched(unsupported, 'flightaware').detail, /FLIGHTAWARE_HISTORY/);
  assert.equal(requested.length, cases.length);
});

test('FlightAware sends one page for archived airport movements and published schedules', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-25T00:00:00Z'));
  const { requested } = fixture(t);
  const providers = ['flightaware'];
  const env = { FLIGHTAWARE_API_KEY: 'fa-fixture', FLIGHTAWARE_HISTORY: 'true' };
  const history = { operation: 'history', providers, airport: 'ICN', date: '2026-11-23', direction: 'arrival', cursor: 'a+b' };
  const archived = await lookup(history, env);
  assert.equal(matched(archived, 'flightaware').time_filter_basis, 'scheduled_on');
  assert.equal(requested[0].url.pathname, '/aeroapi/history/airports/ICN/flights/arrivals');
  assert.deepEqual(Object.fromEntries(requested[0].url.searchParams), {
    start: '2026-11-22T15:00:00.000Z', end: '2026-11-23T15:00:00.000Z', cursor: 'a+b',
  });

  const route = await lookup({ ...history, direction: 'departure', oppositeAirport: 'RJAA' }, env);
  assert.equal(matched(route, 'flightaware').time_filter_basis, 'scheduled_off');
  assert.equal(requested[1].url.pathname, '/aeroapi/history/airports/ICN/flights/to/RJAA');

  const schedule = await lookup({ ...history, operation: 'schedule', direction: 'departure', oppositeAirport: 'NRT', identType: 'flight_number', ident: 'KE703', date: '2026-11-26' }, env);
  assert.equal(matched(schedule, 'flightaware').time_filter_basis, 'scheduled_departure');
  assert.equal(decodeURIComponent(requested[2].url.pathname), '/aeroapi/schedules/2026-11-25T15:00:00.000Z/2026-11-26T15:00:00.000Z');
  assert.deepEqual(Object.fromEntries(requested[2].url.searchParams), { origin: 'ICN', destination: 'NRT', airline: 'KE', flight_number: '703', cursor: 'a+b' });
  assert.equal(requested.length, 3);
});

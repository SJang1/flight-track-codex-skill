import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flightradar24Provider } from '../src/flightradar24-provider.js';

const env = { FLIGHTRADAR24_API_KEY: 'Bearer demo-fr24-key' };
const { operations } = flightradar24Provider;
const liveFlight = { operation: 'flight', identType: 'flight_number', ident: 'KE703' };
const route = { operation: 'airport', direction: 'departure', airport: 'ICN', oppositeAirport: 'NRT' };

test('Flightradar24 sends its documented Bearer, version and live filters', () => {
  assert.equal(operations.flight(liveFlight, {}), null);
  assert.deepEqual(flightradar24Provider.keys, ['FLIGHTRADAR24_API_KEY']);
  assert.equal(flightradar24Provider.exclusive, true);
  const flight = operations.flight(liveFlight, env);
  assert.equal(flight.url.origin, 'https://fr24api.flightradar24.com');
  assert.equal(flight.url.pathname, '/api/live/flight-positions/full');
  assert.deepEqual(flight.headers, { Authorization: 'Bearer demo-fr24-key', Accept: 'application/json', 'Accept-Version': 'v1' });
  assert.deepEqual(Object.fromEntries(flight.url.searchParams), { flights: 'KE703', limit: '10' });
  const airport = operations.airport({ operation: 'airport', airport: 'GMP', direction: 'arrival', limit: 2 }, env);
  assert.deepEqual(Object.fromEntries(airport.url.searchParams), { airports: 'inbound:GMP', limit: '2' });
  const both = operations.airport({ operation: 'airport', airport: 'LHR' }, env);
  assert.deepEqual(Object.fromEntries(both.url.searchParams), { airports: 'LHR', limit: '10' });
  const outbound = operations.airport(route, env);
  assert.deepEqual(Object.fromEntries(outbound.url.searchParams), { routes: 'ICN-NRT', limit: '10' });
  const inbound = operations.airport({ ...route, direction: 'arrival' }, env);
  assert.deepEqual(Object.fromEntries(inbound.url.searchParams), { routes: 'NRT-ICN', limit: '10' });
});

test('Flightradar24 sends UTC summary ranges, historical snapshots and track IDs', () => {
  const summary = operations.airport({ ...route, date: '2025-01-20' }, env);
  assert.equal(summary.url.pathname, '/api/flight-summary/light');
  assert.deepEqual(Object.fromEntries(summary.url.searchParams), {
    routes: 'ICN-NRT', flight_datetime_from: '2025-01-20T00:00:00Z', flight_datetime_to: '2025-01-20T23:59:59Z', limit: '10',
  });
  const history = { operation: 'history', identType: 'callsign', ident: 'KAL703', start: '2025-01-20T03:00:00+09:00' };
  const range = operations.history({ ...history, end: '2025-01-20T06:30:00+09:00' }, env);
  assert.deepEqual(Object.fromEntries(range.url.searchParams), {
    callsigns: 'KAL703', flight_datetime_from: '2025-01-19T18:00:00Z', flight_datetime_to: '2025-01-19T21:30:00Z', limit: '10',
  });
  const snapshot = operations.history(history, env);
  assert.equal(snapshot.url.pathname, '/api/historic/flight-positions/full');
  assert.deepEqual(Object.fromEntries(snapshot.url.searchParams), { callsigns: 'KAL703', timestamp: '1737309600', limit: '10' });
  const providerId = { identType: 'provider_id', ident: '333ca4a2' };
  const track = operations.track({ ...providerId, operation: 'track' }, env);
  assert.equal(track.url.pathname, '/api/flight-tracks');
  assert.deepEqual(Object.fromEntries(track.url.searchParams), { flight_id: '333ca4a2' });
  const legSummary = operations.flight({ ...providerId, operation: 'flight' }, env);
  assert.equal(legSummary.url.pathname, '/api/flight-summary/light');
  assert.deepEqual(Object.fromEntries(legSummary.url.searchParams), { flight_ids: '333ca4a2' });
  assert.equal(flightradar24Provider.limits({ operation: 'track' })[1].requests, 750);
  assert.equal(flightradar24Provider.limits({ operation: 'flight', limit: 20 })[1].requests, 187);
});

test('Flightradar24 rejects filters it cannot send upstream', () => {
  assert.throws(() => operations.live({ operation: 'live', identType: 'icao24', ident: '4CAD41' }, env), /flight number, ADS-B callsign, or aircraft registration/);
  assert.throws(() => operations.airport({ operation: 'airport', identType: 'provider_id', ident: '333ca4a2' }, env), /IATA flight number/);
  assert.throws(() => operations.track({ ...liveFlight, operation: 'track' }, env), /provider_id/);
  assert.throws(() => operations.airport({ ...route, direction: undefined }, env), /direction/);
  assert.throws(() => operations.flight({ ...liveFlight, page: 2 }, env), /pagination/);
  assert.throws(() => operations.flight({ ...liveFlight, start: '2025-01-01T00:00:00Z', end: '2025-01-16T00:00:00Z' }, env), /14 days/);
  assert.equal(operations.schedule, undefined);
});

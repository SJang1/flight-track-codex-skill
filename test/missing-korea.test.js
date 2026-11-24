import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

async function lookup(input, env) {
  const response = await worker.fetch(new Request("https://site.test/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "aviation_lookup", arguments: input } }),
  }), env);
  return (await response.json()).result;
}

function mockPortal(t) {
  const raw = '{ "response": { "header": { "resultCode": "00" } } }\n';
  const calls = [];
  t.mock.method(globalThis, "fetch", async (address) => {
    const url = new URL(address);
    assert.equal(url.origin, "https://apis.data.go.kr");
    calls.push(url);
    return new Response(raw);
  });
  return { raw, calls };
}

test("Incheon detailed feeds scope native record IDs and expose the all-flight cargo mode", async (t) => {
  const { raw, calls } = mockPortal(t);
  const shared = { operation: "history", identType: "provider_id", ident: "2026112300000004944564", airport: "ICN", direction: "arrival" };
  const env = {
    INCHEON_CARGO_SERVICE_KEY: "cargo-fixture",
    INCHEON_ALL_FLIGHTS_SERVICE_KEY: "all-flights-fixture",
  };

  const detailed = await lookup({ ...shared, providers: ["incheon_cargo"] }, env);
  assert.equal(calls[0].pathname, "/B551177/StatusOfCargoFlightsDeOdp/getCargoArrivalsDeOdp");
  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    serviceKey: "cargo-fixture", pageNo: "1", numOfRows: "10", type: "json", f_id: shared.ident,
  });
  assert.equal(detailed.content[detailed.structuredContent.providers[0].raw_body_content_index].text, raw);

  await lookup({ ...shared, oppositeAirport: "PHX", providers: ["incheon_all_cargo"] }, env);
  assert.equal(calls[1].pathname, "/B551177/statusOfAllFltDeOdp/getFltArrivalsDeOdp");
  assert.deepEqual(Object.fromEntries(calls[1].searchParams), {
    serviceKey: "all-flights-fixture", pageNo: "1", numOfRows: "10", type: "json", passengerOrCargo: "C", fid: shared.ident,
  });
});

test("KAC dated movements use the documented regional direction, route and planned-time filters", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-25T02:00:00Z"));
  const { raw, calls } = mockPortal(t);
  const env = { KAC_FLIGHT_STATUS_SERVICE_KEY: "kac-status-fixture" };
  const input = {
    operation: "history", providers: ["kac_dated_status"], identType: "flight_number", ident: "KE123",
    date: "2026-11-24", airport: "GMP", oppositeAirport: "CJU", direction: "arrival", fromTime: "06:00", toTime: "10:00",
  };
  const result = await lookup(input, env);
  assert.equal(calls[0].pathname, "/B551178/flight-status/arrival");
  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    serviceKey: "kac-status-fixture", pageNo: "1", numOfRows: "10", type: "json",
    searchday: "20261124", from_time: "0600", to_time: "1000", airport_code: "GMP", flight_id: "KE123", dep_airport_code: "CJU",
  });
  const [source] = result.structuredContent.providers;
  assert.equal(source.time_filter_basis, "scheduled_time");
  assert.equal(result.content[source.raw_body_content_index].text, raw);

  await lookup({ ...input, direction: "departure" }, env);
  assert.equal(calls[1].pathname, "/B551178/flight-status/depart");
  assert.equal(calls[1].searchParams.get("arr_airport_code"), "CJU");
  assert.equal(calls[1].searchParams.has("dep_airport_code"), false);

  const invalidDate = await lookup({ ...input, date: "2026-11-20" }, env);
  assert.match(invalidDate.structuredContent.providers[0].detail, /three days ago through six days ahead/);
  assert.equal(calls.length, 2);
});

test("KAC supplemental feeds use the existing dataset credentials and documented scope", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-25T02:00:00Z"));
  const { calls } = mockPortal(t);
  const env = { KAC_FLIGHT_STATUS_SERVICE_KEY: "kac-status-fixture", KAC_SCHEDULE_SERVICE_KEY: "kac-schedule-fixture" };
  const route = { airport: "GMP", oppositeAirport: "HND", direction: "departure" };
  await lookup({ ...route, operation: "airport", providers: ["kac_taxfree_status"] }, env);
  assert.equal(calls[0].pathname, "/B551178/flight-status/taxfree");
  assert.equal(calls[0].searchParams.get("depCityCode"), "GMP");
  assert.equal(calls[0].searchParams.get("arrvCityCode"), "HND");
  assert.equal(calls[0].searchParams.get("searchDate"), "20261125");

  await lookup({ ...route, operation: "schedule", providers: ["kac_taxfree_schedule"] }, env);
  assert.equal(calls[1].pathname, "/B551178/flight-schedule/taxfree-int");
  assert.equal(calls[1].searchParams.get("serviceKey"), "kac-schedule-fixture");
  assert.equal(calls[1].searchParams.has("schDate"), false);

  const dated = await lookup({ ...route, operation: "schedule", providers: ["kac_taxfree_schedule"], date: "2026-11-23" }, env);
  assert.match(dated.structuredContent.providers[0].detail, /no date or time filter/);
  assert.equal(calls.length, 2);
});

test("KAC aircraft assignments use their own credential and exact registration filter", async (t) => {
  const { calls } = mockPortal(t);
  const input = { operation: "flight", identType: "registration", ident: "HL8314", providers: ["kac_aircraft_status"] };
  const env = { KAC_AIRCRAFT_STATUS_SERVICE_KEY: "kac-aircraft-fixture" };
  const missing = await lookup(input, { KAC_FLIGHT_STATUS_SERVICE_KEY: "other-fixture" });
  assert.deepEqual(missing.structuredContent.providers[0].missing_environment_variables, ["KAC_AIRCRAFT_STATUS_SERVICE_KEY"]);
  assert.equal(calls.length, 0);

  await lookup(input, env);
  assert.equal(calls[0].pathname, "/B551178/flight-aircraft-status/info");
  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    serviceKey: "kac-aircraft-fixture", pageNo: "1", numOfRows: "10", type: "json", schAPLno: "HL8314",
  });

  const { providers, ...unselected } = input;
  const generic = await lookup(unselected, env);
  const source = generic.structuredContent.providers.find(({ provider }) => provider === providers[0]);
  assert.equal(source.upstream_attempted, false);
  assert.equal(calls.length, 1);
});

test("Incheon recurring timetables return bounded seasonal route records", async (t) => {
  const { raw, calls } = mockPortal(t);
  const input = { operation: "schedule", providers: ["incheon_passenger_timetable"], airport: "ICN", oppositeAirport: "NRT", page: 2, limit: 5 };
  const env = { INCHEON_PASSENGER_TIMETABLE_SERVICE_KEY: "icn-timetable-fixture" };

  const result = await lookup({ ...input, direction: "departure" }, env);
  assert.equal(calls[0].pathname, "/B551177/PaxFltSched/getPaxFltSchedDepartures");
  assert.deepEqual(Object.fromEntries(calls[0].searchParams), {
    serviceKey: "icn-timetable-fixture", pageNo: "2", numOfRows: "5", type: "json", airport: "NRT",
  });
  const [source] = result.structuredContent.providers;
  assert.match(source.time_filter_note, /seasonal timetable with validity dates and operating weekdays/);
  assert.equal(result.content[source.raw_body_content_index].text, raw);

  await lookup({ ...input, direction: "arrival" }, env);
  assert.equal(calls[1].pathname, "/B551177/PaxFltSched/getPaxFltSchedArrivals");

  const dated = await lookup({ ...input, direction: "arrival", date: "2026-11-25" }, env);
  assert.equal(dated.structuredContent.providers[0].upstream_attempted, false);
  assert.equal(calls.length, 2);
});

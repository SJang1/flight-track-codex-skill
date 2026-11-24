import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.js";

async function call(name, args, env = {}) {
  const request = new Request("https://test.example/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

test("raw bodies and advisory pacing through MCP tools/call", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const raw = '\ufeff { "value": 1, "value": 2 }\r\n';
  const live = { operation: "live", identType: "icao24", ident: "ABC123", providers: ["adsb_fi"] };
  let pulls = 0;
  globalThis.fetch = async (url, options) => {
    pulls++;
    assert.match(String(url), /\/v2\/hex\/abc123$/);
    assert.equal(options.cache, "no-store");
    return new Response(raw, { headers: { "Content-Type": "application/json" } });
  };
  const simultaneous = await Promise.all(Array.from({ length: 8 }, () => call("aviation_lookup", live)));
  for (const { structuredContent, content } of simultaneous) {
    const result = structuredContent.providers[0];
    assert.equal(result.status, "ok");
    assert.equal(result.upstream_attempted, true);
    assert.equal(result.data_request_attempted, true);
    assert.equal(content[result.raw_body_content_index].text, raw);
    assert.equal(structuredContent.pacing_policy, "advisory");
    assert.match(result.recommended_next_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$/);
    assert.equal(result.recommended_next_at, result.next_allowed_at);
    assert.equal(structuredContent.recommended_next_lookup_at, result.recommended_next_at);
    assert.equal(structuredContent.next_lookup_at, result.recommended_next_at);
    assert.ok([...Object.keys(structuredContent), ...Object.keys(result)].every((field) => !field.endsWith("_kst")));
    assert.ok(structuredContent.agent_instruction.includes(result.recommended_next_at));
    assert.match(structuredContent.agent_instruction, /earlier request is allowed/);
  }
  const immediate = await call("aviation_lookup", live, { AVIATION_RATE_LIMITS: "malformed" });
  assert.equal(immediate.structuredContent.providers[0].status, "ok");
  assert.equal(immediate.structuredContent.providers[0].quota_configuration_error, true);
  assert.equal(pulls, 9);

  const withoutKey = await call("aviation_lookup", { operation: "flight", ident: "KE93", providers: ["airlabs"] });
  assert.equal(withoutKey.structuredContent.providers[0].status, "missing_credentials");
  const noStackKey = await call("aviation_lookup", {
    operation: "flight", identType: "flight_number", ident: "KE93", providers: ["aviationstack"],
  }, { AVIATIONSTACK_API_KEY: "  " });
  const [skippedStack] = noStackKey.structuredContent.providers;
  assert.equal(skippedStack.status, "missing_credentials");
  assert.equal(skippedStack.upstream_attempted, false);
  assert.equal(skippedStack.data_request_attempted, false);
  assert.equal(skippedStack.http_status, undefined);
  assert.equal(skippedStack.raw_body_content_index, undefined);
  const separate = await call("aviation_lookup", { operation: "flight", ident: "KE93", providers: ["airlabs", "flightaware"] });
  assert.equal(separate.isError, true);
  assert.equal(pulls, 9);

  const retryInput = { ...live, providers: ["adsb_lol"] };
  const adsbWithoutKey = await call("aviation_lookup", retryInput);
  assert.equal(adsbWithoutKey.structuredContent.providers[0].status, "missing_credentials");
  assert.deepEqual(adsbWithoutKey.structuredContent.providers[0].missing_environment_variables, ["ADSB_LOL_API_KEY"]);
  assert.equal(pulls, 9);

  const adsbEnv = { ADSB_LOL_API_KEY: "DEMO_ADSB_KEY" };
  globalThis.fetch = async (_url, options) => {
    pulls++;
    assert.equal(new Headers(options.headers).get("x-api-key"), adsbEnv.ADSB_LOL_API_KEY);
    return new Response('<error>try later</error>\n', {
      status: 429, headers: { "Content-Type": "application/xml", "Retry-After": "600" },
    });
  };
  const failure = await call("aviation_lookup", retryInput, adsbEnv);
  const failed = failure.structuredContent.providers[0];
  assert.equal(failed.http_status, 429);
  assert.deepEqual(failed.quota_headers, { "retry-after": "600" });
  assert.equal(failure.content[failed.raw_body_content_index].text, '<error>try later</error>\n');
  assert.ok(Date.parse(failed.recommended_next_at) - Date.now() > 595_000);
  const afterRetry = await call("aviation_lookup", retryInput, adsbEnv);
  assert.equal(afterRetry.structuredContent.providers[0].http_status, 429);
  assert.equal(pulls, 11);

  const key = "mock+token 123";
  globalThis.fetch = async (url) => new Response(JSON.stringify({ echo: url.search.slice(1) }));
  const withKey = await call("aviation_lookup", { operation: "flight", ident: "KE93", providers: ["airlabs"] }, { AIRLABS_API_KEY: key });
  const keyed = withKey.structuredContent.providers[0];
  assert.equal(keyed.credential_redacted, true);
  assert.doesNotMatch(withKey.content[keyed.raw_body_content_index].text, /mock|token/);

  const airnavInput = { operation: "history", identType: "flight_number", ident: "KE93", date: "2026-11-24", providers: ["airnavradar"] };
  const airnavRaw = '{"cost":2, "flights":[]}\n';
  globalThis.fetch = async (url, options) => {
    assert.equal(url.origin, "https://api.airnavradar.com");
    assert.equal(url.searchParams.get("pageSize"), "1");
    assert.equal(options.headers.Authorization, "Bearer DEMO_KEY");
    return new Response(airnavRaw);
  };
  const airnav = await call("aviation_lookup", airnavInput, { AIRNAVRADAR_API_TOKEN: "DEMO_KEY" });
  const charged = airnav.structuredContent.providers[0];
  assert.equal(charged.charged_credits, 2);
  assert.equal(airnav.content[charged.raw_body_content_index].text, airnavRaw);
  assert.ok(Date.parse(charged.recommended_next_at) - Date.now() > 2 * 26_784_000 - 1000);

  const skyInput = { ...live, providers: ["opensky"] };
  const skyRaw = '{ "states": null }\n';
  let skyExhausted = false;
  let skyCalls = 0;
  globalThis.fetch = async (url, options) => {
    skyCalls++;
    const target = new URL(url);
    if (target.hostname === "auth.opensky-network.org") {
      assert.equal(options.redirect, "manual");
      assert.equal(options.method, "POST");
      assert.equal(options.cache, undefined);
      assert.equal(options.body.get("grant_type"), "client_credentials");
      return Response.json({ access_token: "mock-access-token" });
    }
    assert.equal(target.hostname, "opensky-network.org");
    assert.equal(options.headers.Authorization, "Bearer mock-access-token");
    if (skyExhausted) return new Response("try again later", {
      status: 429,
      headers: { "X-Rate-Limit-Retry-After-Seconds": "3600" },
    });
    return new Response(skyRaw, {
      headers: {
        "X-Rate-Limit-Remaining": "03996",
        "X-Rate-Limit-Policy": "mock-access-token",
        "Set-Cookie": "session=mock-session",
      },
    });
  };
  const skyCredentials = { OPENSKY_CLIENT_ID: "mock-client", OPENSKY_CLIENT_SECRET: "mock-secret" };
  const sky = await call("aviation_lookup", skyInput, skyCredentials);
  const skySource = sky.structuredContent.providers[0];
  assert.equal(skySource.status, "ok");
  assert.equal(skySource.quota_bucket, "opensky:states");
  assert.deepEqual(skySource.quota_headers, { "x-rate-limit-remaining": "03996", "x-rate-limit-policy": "[REDACTED]" });
  assert.equal(sky.content[skySource.raw_body_content_index].text, skyRaw);
  assert.equal(skyCalls, 2);
  assert.ok(!JSON.stringify(sky).includes("mock-access-token"));

  skyExhausted = true;
  const retryStartedAt = Date.now();
  const exhausted = await call("aviation_lookup", skyInput, skyCredentials);
  const exhaustedSource = exhausted.structuredContent.providers[0];
  assert.deepEqual(exhaustedSource.quota_headers, { "x-rate-limit-retry-after-seconds": "3600" });
  assert.ok(Date.parse(exhaustedSource.recommended_next_at) >= retryStartedAt + 3_600_000);

  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 307, headers: { Location: "https://example.com/", "X-Rate-Limit-Remaining": "1" } });
  };
  const redirected = await call("aviation_lookup", skyInput, skyCredentials);
  const oauthStatus = redirected.structuredContent.providers[0];
  assert.equal(oauthStatus.authorization_diagnostic, "oauth_http_error");
  assert.equal(oauthStatus.http_status, 307);
  assert.equal(oauthStatus.quota_headers, undefined);
  assert.equal(oauthStatus.raw_body_content_index, undefined);

  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, "auth.opensky-network.org");
    return new Response("mock-secret", { status: 522, headers: { "CF-Ray": "0123456789abcdef-ZRH", "CF-Error-Type": "origin", "Set-Cookie": "internal=value" } });
  };
  const unreachable = await call("aviation_lookup", skyInput, skyCredentials);
  const unreachableSource = unreachable.structuredContent.providers[0];
  assert.equal(unreachableSource.status, "authorization_failed");
  assert.equal(unreachableSource.upstream_attempted, true);
  assert.equal(unreachableSource.data_request_attempted, false);
  assert.equal(unreachableSource.http_status, 522);
  assert.equal(unreachableSource.authorization_diagnostic, "oauth_origin_connection_timeout");
  assert.deepEqual(unreachableSource.authorization_response_headers, { "cf-ray": "0123456789abcdef-ZRH", "cf-error-type": "origin" });
  assert.equal(unreachable.content.length, 1);
  assert.doesNotMatch(unreachable.content[0].text, /mock-secret|internal=value/);

  const portalKey = "mock+portal/key==";
  const encodedPortalKey = encodeURIComponent(portalKey);
  const passengerKey = "passenger+portal/key==";
  const portalEnv = {
    INCHEON_CARGO_SERVICE_KEY: portalKey,
    INCHEON_ALL_FLIGHTS_SERVICE_KEY: encodedPortalKey,
    INCHEON_PASSENGER_SERVICE_KEY: encodeURIComponent(passengerKey),
  };
  for (const [direction, suffix] of [["arrival", "Arrivals"], ["departure", "Departures"]]) {
    const expectedKeys = new Map([
      [`/B551177/StatusOfCargoFlightsDeOdp/getCargo${suffix}DeOdp`, portalKey],
      [`/B551177/statusOfAllFltDeOdp/getFlt${suffix}DeOdp`, portalKey],
      [`/B551177/StatusOfPassengerFlightsDeOdp/getPassenger${suffix}DeOdp`, passengerKey],
    ]);
    globalThis.fetch = async (url) => {
      const key = expectedKeys.get(url.pathname);
      assert.ok(key, url.pathname);
      expectedKeys.delete(url.pathname);
      assert.equal(url.searchParams.get("serviceKey"), key);
      const allFlights = url.pathname.includes("/statusOfAllFltDeOdp/");
      assert.equal(url.searchParams.get(allFlights ? "flightId" : "flight_id"), "KE703");
      assert.equal(url.searchParams.has(allFlights ? "airportCode" : "airport_code"), false);
      const dedicatedPassenger = url.pathname.includes("/StatusOfPassengerFlightsDeOdp/");
      assert.equal(url.searchParams.get("inqtimechcd"), dedicatedPassenger ? "E" : null);
      for (const param of ["passengerOrCargo", "searchdtCode", "searchDate", "from_time", "to_time", "searchFrom", "searchTo", "lang"]) {
        assert.equal(url.searchParams.has(param), false, param);
      }
      return Response.json({ reflected: key, encoded: encodeURIComponent(key) });
    };
    const paired = await call("aviation_lookup", {
      operation: "airport", providers: ["incheon_cargo", "incheon_passenger", "incheon_passenger_detail"], airport: "ICN",
      oppositeAirport: "NRT", direction, ident: "KE703", identType: "flight_number", limit: 1,
    }, portalEnv);
    assert.equal(expectedKeys.size, 0);
    assert.equal(paired.structuredContent.providers.length, 3);
    for (const row of paired.structuredContent.providers) {
      assert.equal(row.status, "ok");
      assert.ok(row.route_filter_note);
      assert.equal(row.credential_redacted, true);
      assert.deepEqual(JSON.parse(paired.content[row.raw_body_content_index].text), { reflected: "[REDACTED]", encoded: "[REDACTED]" });
    }
  }

  const routeInput = {
    operation: "airport", direction: "departure", airport: "RKSI", oppositeAirport: "RJAA",
    identType: "flight_number", ident: "KE703", date: "2026-11-24",
  };
  let routePulls = 0;
  globalThis.fetch = async (url, options) => {
    routePulls++;
    assert.equal(url.pathname, "/v2/flights/search");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.fromAirports, ["RKSI"]);
    assert.deepEqual(body.toAirports, ["RJAA"]);
    assert.deepEqual(body.flightIds, ["KE703"]);
    assert.equal(url.searchParams.get("pageSize"), "1");
    assert.equal(body.page, undefined);
    assert.equal(body.pageSize, undefined);
    assert.equal(body.includeFlightUrls, undefined);
    return new Response(airnavRaw);
  };
  const airnavRoute = await call("aviation_lookup", { ...routeInput, providers: ["airnavradar"] }, { AIRNAVRADAR_API_TOKEN: "DEMO_KEY" });
  assert.equal(airnavRoute.structuredContent.providers[0].status, "ok");
  assert.equal(routePulls, 1);

  const unsupportedRoute = await call("aviation_lookup", { ...routeInput, providers: ["aerodatabox"] }, { AERODATABOX_API_KEY: "DEMO_KEY" });
  assert.equal(unsupportedRoute.structuredContent.providers[0].status, "unsupported_input");
  assert.equal(routePulls, 1);
});

test("Flightradar24 joins eligible lookups and can be selected or excluded", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = { operation: "flight", identType: "flight_number", ident: "KE703" };
  const env = { FLIGHTRADAR24_API_KEY: "mock-flightradar24-key", AIRLABS_API_KEY: "mock-airlabs-key" };
  const raw = '{ "data": [] }\n';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(raw);
  };
  const withoutKey = await call("aviation_lookup", base, { AIRLABS_API_KEY: env.AIRLABS_API_KEY });
  const missing = withoutKey.structuredContent.providers.find(({ provider }) => provider === "flightradar24");
  assert.equal(missing.status, "missing_credentials");
  assert.equal(missing.upstream_attempted, false);
  assert.equal(missing.data_request_attempted, false);
  assert.deepEqual(requests.map(({ url }) => url.hostname), ["airlabs.co"]);

  for (const selection of [{}, { providers: ["flightradar24", "airlabs"] }, { providers: ["flightradar24"] }]) {
    requests.length = 0;
    const result = await call("aviation_lookup", { ...base, ...selection }, env);
    const source = result.structuredContent.providers.find(({ provider }) => provider === "flightradar24");
    assert.equal(source.status, "ok");
    assert.equal(source.upstream_attempted, true);
    assert.equal(source.data_request_attempted, true);
    assert.equal(result.content[source.raw_body_content_index].text, raw);
    const hostnames = selection.providers?.length === 1
      ? ["fr24api.flightradar24.com"]
      : ["airlabs.co", "fr24api.flightradar24.com"];
    assert.deepEqual(requests.map(({ url }) => url.hostname).sort(), hostnames);
    const fr24Request = requests.find(({ url }) => url.hostname === "fr24api.flightradar24.com");
    assert.equal(fr24Request.options.headers.Authorization, `Bearer ${env.FLIGHTRADAR24_API_KEY}`);
  }

  requests.length = 0;
  const excluded = await call("aviation_lookup", { ...base, excludeProviders: ["flightradar24"] }, env);
  assert.ok(excluded.structuredContent.providers.every(({ provider }) => provider !== "flightradar24"));
  assert.deepEqual(requests.map(({ url }) => url.hostname), ["airlabs.co"]);
});

test("airport context returns reference data with flight results and respects provider selection", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  const raw = '{ "airport-fixture": true }\n';
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(raw);
  };
  const flight = { operation: "flight", identType: "flight_number", ident: "KE703", airport: "ICN", oppositeAirport: "NRT", direction: "departure" };
  const env = { INCHEON_PASSENGER_SERVICE_KEY: "dummy-incheon-key", FLIGHTRADAR24_API_KEY: "dummy-fr24-key" };
  const result = await call("aviation_lookup", { ...flight, providers: ["incheon_passenger_detail", "freeairportdb"] }, env);
  const rows = result.structuredContent.providers;
  const airportRows = rows.filter(({ result_kind }) => result_kind === "airport_info");
  assert.deepEqual(airportRows.map(({ airport_code }) => airport_code).sort(), ["ICN", "NRT"]);
  assert.ok(airportRows.every((source) => result.content[source.raw_body_content_index].text === raw));
  const incheon = rows.find(({ provider }) => provider === "incheon_passenger_detail");
  assert.equal(requests.find((url) => url.hostname === "apis.data.go.kr").searchParams.has("airport_code"), false);
  assert.ok(incheon.route_filter_note);
  assert.equal(result.structuredContent.recommended_next_lookup_at, incheon.recommended_next_at);

  requests.length = 0;
  const defaults = await call("aviation_lookup", flight, env);
  const defaultAirports = defaults.structuredContent.providers.filter(({ result_kind }) => result_kind === "airport_info");
  assert.deepEqual(defaultAirports.map(({ airport_code }) => airport_code).sort(), ["ICN", "NRT"]);
  assert.ok(defaultAirports.every(({ provider }) => provider === "freeairportdb"));
  assert.deepEqual(requests.filter((url) => url.hostname === "fr24api.flightradar24.com").map((url) => url.pathname), [
    "/api/live/flight-positions/full",
  ]);
  assert.equal(requests.find((url) => url.hostname === "fr24api.flightradar24.com").searchParams.get("routes"), "ICN-NRT");

  requests.length = 0;
  const onlyFr24 = await call("aviation_lookup", { ...flight, providers: ["flightradar24"] }, env);
  assert.ok(onlyFr24.structuredContent.providers.every(({ provider }) => provider === "flightradar24"));
  assert.deepEqual(requests.map((url) => url.pathname).sort(), [
    "/api/live/flight-positions/full", "/api/static/airports/ICN/light", "/api/static/airports/NRT/light",
  ]);

  requests.length = 0;
  await call("aviation_lookup", { ...flight, providers: ["incheon_passenger_detail", "freeairportdb"], excludeProviders: ["freeairportdb"] }, env);
  assert.deepEqual(requests.map((url) => url.hostname), ["apis.data.go.kr"]);
});

test("Incheon endpoints keep flight and time filters and apply opposite airport only for route searches", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-24T20:00:00Z"));
  const urls = new Map();
  const raw = '{ "flightId": "FX5926", "airportCode": "ANC" }';
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.set(url.pathname, url.searchParams);
    return new Response(raw);
  });

  const endpoints = [
    {
      provider: "incheon_cargo", serviceKey: "INCHEON_CARGO_SERVICE_KEY",
      action: "StatusOfCargoFlightsDeOdp/getCargoArrivalsDeOdp",
      flight: "flight_id", airport: "airport_code", date: "searchday", from: "from_time", to: "to_time",
    },
    {
      provider: "incheon_cargo_today", serviceKey: "INCHEON_CARGO_TODAY_SERVICE_KEY",
      action: "StatusOfCargoFlights/getCargoArrivals",
      flight: "flight_id", airport: "airport", from: "from_time", to: "to_time",
    },
    {
      provider: "incheon_passenger", serviceKey: "INCHEON_ALL_FLIGHTS_SERVICE_KEY",
      action: "statusOfAllFltDeOdp/getFltArrivalsDeOdp",
      flight: "flightId", airport: "airportCode", date: "searchDate", from: "searchFrom", to: "searchTo",
    },
    {
      provider: "incheon_passenger_detail", serviceKey: "INCHEON_PASSENGER_SERVICE_KEY",
      action: "StatusOfPassengerFlightsDeOdp/getPassengerArrivalsDeOdp",
      flight: "flight_id", airport: "airport_code", date: "searchday", from: "from_time", to: "to_time",
    },
  ];
  const input = {
    operation: "airport", providers: endpoints.map(({ provider }) => provider),
    airport: "ICN", oppositeAirport: "NRT", direction: "arrival", date: "2026-11-25", fromTime: "0600", toTime: "1000",
  };
  const env = Object.fromEntries(endpoints.map(({ serviceKey }) => [serviceKey, `mock-${serviceKey}`]));

  for (const ident of ["FX5926", undefined]) {
    const filters = ident ? { operation: "flight", ident, identType: "flight_number" } : {};
    const { structuredContent, content } = await call("aviation_lookup", { ...input, ...filters }, env);
    assert.equal(urls.size, endpoints.length);
    for (const endpoint of endpoints) {
      const upstream = urls.get(`/B551177/${endpoint.action}`);
      const row = structuredContent.providers.find(({ provider }) => provider === endpoint.provider);
      assert.equal(row.status, "ok");
      assert.equal(content[row.raw_body_content_index].text, raw);
      assert.equal(Boolean(row.route_filter_note), Boolean(ident));
      assert.equal(upstream.get(endpoint.airport), ident ? null : "NRT");
      assert.equal(upstream.get(endpoint.flight), ident ?? null);
      assert.equal(upstream.get(endpoint.from), "0600");
      assert.equal(upstream.get(endpoint.to), "1000");
      if (endpoint.date) assert.equal(upstream.get(endpoint.date), "20261125");
    }
    urls.clear();
  }
});

test("provider filters apply before credential requests, including in native FR24 lookups", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const hosts = [];
  globalThis.fetch = async (url) => {
    hosts.push(new URL(url).hostname);
    return Response.json({ sample: true });
  };
  const env = {
    ADSB_LOL_API_KEY: "dummy-adsb-lol", OPENSKY_CLIENT_ID: "dummy-sky-client", OPENSKY_CLIENT_SECRET: "dummy-sky-secret",
    FLIGHTRADAR24_API_KEY: "dummy-fr24-key",
  };
  const live = { operation: "live", identType: "icao24", ident: "ABC123" };

  const defaults = await call("aviation_lookup", { ...live, excludeProviders: ["opensky", "adsb_lol"] }, env);
  assert.deepEqual(hosts.sort(), ["avioadsb.org", "opendata.adsb.fi"]);
  assert.ok(defaults.structuredContent.providers.every(({ provider }) => !["opensky", "adsb_lol"].includes(provider)));

  hosts.length = 0;
  const narrowed = await call("aviation_lookup", { ...live, providers: ["opensky", "adsb_fi"], excludeProviders: ["opensky"] }, env);
  assert.deepEqual(hosts, ["opendata.adsb.fi"]);
  assert.deepEqual(narrowed.structuredContent.providers.map(({ provider }) => provider), ["adsb_fi"]);

  hosts.length = 0;
  const native = { operation: "fr24", fr24Endpoint: "usage" };
  const fr24 = await call("aviation_lookup", { ...native, providers: ["flightradar24", "opensky"], excludeProviders: ["opensky"] }, env);
  assert.deepEqual(hosts, ["fr24api.flightradar24.com"]);
  assert.equal(fr24.structuredContent.providers[0].status, "ok");

  hosts.length = 0;
  const { structuredContent: catalog } = await call("aviation_providers", {});
  for (const request of [
    { ...live, providers: ["adsb_fi"], excludeProviders: ["adsb_fi"] },
    { ...live, excludeProviders: catalog.providers.map(({ id }) => id) },
    { ...live, excludeProviders: ["opensk"] },
    { ...live, excludeProviders: ["opensky", "opensky"] },
    { ...native, excludeProviders: ["flightradar24"] },
  ]) {
    const rejected = await call("aviation_lookup", request, env);
    assert.equal(rejected.isError, true, JSON.stringify(request));
  }
  assert.deepEqual(hosts, []);
});

test("a known aircraft identifier adds live positions to a current flight lookup", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return Response.json({ sample: true });
  };
  const query = { operation: "flight", identType: "flight_number", ident: "KE703", callsign: "kal703", providers: ["adsb_fi"] };
  const current = await call("aviation_lookup", query);
  assert.equal(current.structuredContent.providers[0].result_kind, "aircraft_position");
  assert.equal(requests[0].pathname, "/api/v2/callsign/KAL703");
  const historical = await call("aviation_lookup", { ...query, date: "2025-01-20" });
  assert.equal(historical.structuredContent.providers[0].upstream_attempted, false);
  assert.equal(requests.length, 1);
});

test("KAC schedules can filter by an exact flight without airport or direction", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return Response.json({ schedule: true });
  };
  const base = { operation: "schedule", identType: "flight_number", providers: ["kac_schedule"] };
  const env = { KAC_SCHEDULE_SERVICE_KEY: "dummy-kac-schedule-key" };
  await call("aviation_lookup", { ...base, ident: "KE123", market: "domestic" }, env);
  const international = { ...base, ident: "NH862", market: "international" };
  await call("aviation_lookup", { ...international, start: "2026-11-24T15:00:00Z", end: "2026-11-25T15:00:00Z" }, env);
  const { structuredContent } = await call("aviation_lookup", { ...international, fromTime: "0600" }, env);
  assert.equal(structuredContent.providers[0].status, "unsupported_input");
  assert.equal(structuredContent.providers[0].upstream_attempted, false);
  assert.match(structuredContent.providers[0].detail, /whole-day date filters/);
  assert.deepEqual(requests.map((url) => url.pathname.split("/").at(-1)), ["dom", "int"]);
  assert.deepEqual(requests.map((url) => url.searchParams.get("schFlightNum")), ["123", "NH862"]);
  assert.equal(requests[0].searchParams.get("schAirLine"), "KE");
  assert.equal(requests[1].searchParams.get("schDate"), "20261125");
  assert.ok(requests.every((url) => !url.searchParams.has("schDeptCityCode") && !url.searchParams.has("schArrvCityCode")));
});

test("KAC real-time status and flight-number search use their documented endpoints and keys", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const statusKey = "status+mock/key==";
  const searchKey = "search+mock/key==";
  const env = {
    KAC_FLIGHT_STATUS_SERVICE_KEY: encodeURIComponent(statusKey),
    KAC_FLIGHT_SEARCH_SERVICE_KEY: searchKey,
  };
  const expectedRequests = new Map([
    ["/B551178/flight-status/info", {
      serviceKey: statusKey, schLineType: "D", schIOType: "O", schAirCode: "GMP",
      schStTime: "0600", schEdTime: "1800", type: "xml",
    }],
    ["/B551178/flight-status/detail", {
      serviceKey: statusKey, pageNo: "2", numOfRows: "3", type: "xml",
    }],
    ["/B551178/flight-search/info", {
      serviceKey: searchKey, schFln: "KE703", type: "json",
    }],
  ]);
  const rawXml = '<?xml version="1.0" encoding="UTF-8"?>\r\n<response><items /></response>\r\n';
  let pulls = 0;
  globalThis.fetch = async (url) => {
    pulls++;
    assert.equal(url.origin, "https://apis.data.go.kr");
    assert.deepEqual(Object.fromEntries(url.searchParams), expectedRequests.get(url.pathname));
    expectedRequests.delete(url.pathname);
    return url.searchParams.get("type") === "xml"
      ? new Response(rawXml, { headers: { "Content-Type": "application/xml" } })
      : Response.json({ response: {} });
  };

  const detailInput = { operation: "airport", providers: ["kac_realtime_status_detail"], page: 2, limit: 3, format: "xml" };
  const lookups = [
    {
      operation: "airport", providers: ["kac_realtime_status"], airport: "GMP", direction: "departure",
      market: "domestic", fromTime: "0600", toTime: "1800", format: "xml",
    },
    detailInput,
    { operation: "flight", providers: ["kac_flight_status"], ident: "KE703", identType: "flight_number" },
  ];
  for (const input of lookups) {
    const { structuredContent, content } = await call("aviation_lookup", input, env);
    const [provider] = structuredContent.providers;
    assert.equal(provider.status, "ok");
    assert.equal(content[provider.raw_body_content_index].text, input.format === "xml" ? rawXml : '{"response":{}}');
  }
  assert.equal(expectedRequests.size, 0);

  for (const filters of [{ airport: "GMP" }, { ident: "KE703", identType: "flight_number" }, { fromTime: "0600" }, { cursor: "other-provider-cursor" }]) {
    const { structuredContent } = await call("aviation_lookup", { ...detailInput, ...filters }, env);
    assert.equal(structuredContent.providers[0].status, "unsupported_input");
  }
  assert.equal(pulls, lookups.length);
});

test("Korean airport adapters preserve equivalent UTC and local windows with endpoint-specific midnight bounds", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-24T20:00:00Z"));
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return Response.json({ response: {} });
  });

  const date = "2026-11-25";
  const local = { date, fromTime: "06:00", toTime: "10:00" };
  const utc = { start: "2026-11-24T21:00:00Z", end: "2026-11-25T01:00:00Z" };
  const midnight = { start: "2026-11-25T14:00:00Z", end: "2026-11-25T15:00:00Z" };
  const nextDay = { ...midnight, end: "2026-11-25T16:00:00Z" };
  const cases = [
    {
      input: { operation: "flight", ident: "FX5926", identType: "flight_number", airport: "ICN", direction: "arrival", providers: ["incheon_cargo"] },
      env: { INCHEON_CARGO_SERVICE_KEY: "mock-incheon-cargo-key" },
      path: "/B551177/StatusOfCargoFlightsDeOdp/getCargoArrivalsDeOdp",
      dateField: "searchday", fromField: "from_time", toField: "to_time", midnightBound: "2400",
    },
    {
      input: { operation: "airport", airport: "GMP", direction: "departure", providers: ["kac_realtime_status"] },
      env: { KAC_FLIGHT_STATUS_SERVICE_KEY: "mock-kac-status-key" },
      path: "/B551178/flight-status/info",
      dateField: "schDate", fromField: "schStTime", toField: "schEdTime", midnightBound: "2359",
    },
  ];

  for (const { input, env, path, dateField, fromField, toField, midnightBound } of cases) {
    const first = urls.length;
    for (const range of [local, utc, midnight]) {
      const { structuredContent } = await call("aviation_lookup", { ...input, ...range }, env);
      assert.equal(structuredContent.providers[0].status, "ok");
    }
    const [localUrl, utcUrl, midnightUrl] = urls.slice(first);
    assert.equal(localUrl.pathname, path);
    assert.equal(utcUrl.href, localUrl.href);
    assert.equal(localUrl.searchParams.get(dateField), dateField === "searchday" ? "20261125" : null);
    assert.equal(localUrl.searchParams.get(fromField), "0600");
    assert.equal(localUrl.searchParams.get(toField), "1000");
    assert.equal(midnightUrl.searchParams.get(fromField), "2300");
    assert.equal(midnightUrl.searchParams.get(toField), midnightBound);

    const { structuredContent } = await call("aviation_lookup", { ...input, ...nextDay }, env);
    const [skipped] = structuredContent.providers;
    assert.equal(skipped.status, "unsupported_input");
    assert.equal(skipped.upstream_attempted, false);
    assert.match(skipped.detail, /only one Korea-local day/);
    assert.equal(urls.length, first + 3);
  }
});

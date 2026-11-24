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
      assert.equal(url.searchParams.get(allFlights ? "airportCode" : "airport_code"), "NRT");
      assert.equal(url.searchParams.get("passengerOrCargo"), allFlights ? "P" : null);
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
    assert.equal(body.pageSize, 1);
    return new Response(airnavRaw);
  };
  const airnavRoute = await call("aviation_lookup", { ...routeInput, providers: ["airnavradar"] }, { AIRNAVRADAR_API_TOKEN: "DEMO_KEY" });
  assert.equal(airnavRoute.structuredContent.providers[0].status, "ok");
  assert.equal(routePulls, 1);

  const unsupportedRoute = await call("aviation_lookup", { ...routeInput, providers: ["aerodatabox"] }, { AERODATABOX_API_KEY: "DEMO_KEY" });
  assert.equal(unsupportedRoute.structuredContent.providers[0].status, "unsupported_input");
  assert.equal(routePulls, 1);
});

test("Flightradar24 is available by explicit selection with a configured key", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const base = { operation: "flight", identType: "flight_number", ident: "KE703" };
  const lookup = { ...base, providers: ["flightradar24"] };
  const env = { FLIGHTRADAR24_API_KEY: "mock-flightradar24-key" };
  const raw = '{ "data": [] }\n';
  let fetchCount = 0;
  globalThis.fetch = async (url, options) => {
    fetchCount++;
    assert.equal(url.hostname, "fr24api.flightradar24.com");
    assert.equal(options.headers.Authorization, `Bearer ${env.FLIGHTRADAR24_API_KEY}`);
    return new Response(raw);
  };
  const withoutKey = await call("aviation_lookup", lookup);
  assert.equal(withoutKey.structuredContent.providers[0].status, "missing_credentials");
  const defaultProviders = await call("aviation_lookup", base, env);
  assert.equal(defaultProviders.structuredContent.providers.find(({provider}) => provider === "flightradar24").status, "select_individually");
  const mixed = await call("aviation_lookup", { ...base, providers: ["flightradar24", "airlabs"] }, env);
  assert.equal(mixed.isError, true);
  assert.equal(fetchCount, 0);
  const keyed = await call("aviation_lookup", lookup, env);
  const source = keyed.structuredContent.providers[0];
  assert.equal(source.status, "ok");
  assert.equal(keyed.content[source.raw_body_content_index].text, raw);
  assert.equal(fetchCount, 1);
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

  for (const filters of [{ airport: "GMP" }, { ident: "KE703", identType: "flight_number" }, { fromTime: "0600" }]) {
    const { structuredContent } = await call("aviation_lookup", { ...detailInput, ...filters }, env);
    assert.equal(structuredContent.providers[0].status, "unsupported_input");
  }
  assert.equal(pulls, lookups.length);
});

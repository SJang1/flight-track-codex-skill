import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.js";

const args = { operation: "live", identType: "icao24", ident: "ABC123", providers: ["adsb_lol", "avioadsb"] };
const env = { ADSB_LOL_API_KEY: "DEMO_ADSB_KEY" };
const fastRaw = ' { "source": "AvioADSB", "label": "원문" }\r\n';
const slowRaw = '{"source":"adsb.lol"}\n';
const fastQuota = { "x-avioadsb-tier": "anonymous", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1200" };

function stubProviders(t) {
  const originalFetch = globalThis.fetch;
  const started = new Set();
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  globalThis.fetch = async (url) => {
    const host = new URL(url).hostname;
    started.add(host);
    if (host === "avioadsb.org") return new Response(fastRaw, { headers: { "Content-Type": "application/json", ...fastQuota } });
    assert.equal(host, "api.adsb.lol");
    await slow;
    return new Response(slowRaw, { headers: { "Content-Type": "application/json" } });
  };
  t.after(() => {
    releaseSlow();
    globalThis.fetch = originalFetch;
  });
  return { started, releaseSlow };
}

async function* lines(body) {
  let pending = "";
  for await (const text of body.pipeThrough(new TextDecoderStream())) {
    pending += text;
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end).replace(/\r$/, "");
      pending = pending.slice(end + 1);
      yield line;
    }
  }
  assert.equal(pending, "");
}

async function* sseMessages(body) {
  let data = [];
  for await (const line of lines(body)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    if (line === "" && data.length) {
      yield JSON.parse(data.join("\n"));
      data = [];
    }
  }
  assert.equal(data.length, 0);
}

test("private NDJSON emits each raw provider response as it completes", { timeout: 5000 }, async (t) => {
  const { started, releaseSlow } = stubProviders(t);
  const response = await worker.fetch(new Request("https://test.example/lookup/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://test.example",
      "oai-authenticated-user-id": "stream-test",
    },
    body: JSON.stringify(args),
  }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/x-ndjson\b/);
  const stream = lines(response.body);

  const first = JSON.parse((await stream.next()).value);
  assert.equal(first.type, "provider");
  assert.equal(first.source.provider, "avioadsb");
  assert.equal(first.source.status, "ok");
  assert.deepEqual(first.source.quota_headers, fastQuota);
  assert.equal(first.raw_body, fastRaw);
  assert.deepEqual(started, new Set(["api.adsb.lol", "avioadsb.org"]));

  releaseSlow();
  const second = JSON.parse((await stream.next()).value);
  assert.equal(second.type, "provider");
  assert.equal(second.source.provider, "adsb_lol");
  assert.equal(second.source.quota_headers, undefined);
  assert.equal(second.raw_body, slowRaw);
  const complete = JSON.parse((await stream.next()).value);
  assert.equal(complete.type, "complete");
  assert.deepEqual(new Set(complete.structuredContent.providers.map(({ provider }) => provider)), new Set(args.providers));
  assert.equal((await stream.next()).done, true);
});

test("direct NDJSON lookup excludes a provider before dispatch", { timeout: 5000 }, async (t) => {
  const { started, releaseSlow } = stubProviders(t);
  releaseSlow();
  const response = await worker.fetch(new Request("https://test.example/lookup/stream", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...args, excludeProviders: ["adsb_lol"] }),
  }), env);
  const records = [];
  for await (const line of lines(response.body)) records.push(JSON.parse(line));
  assert.deepEqual(started, new Set(["avioadsb.org"]));
  assert.deepEqual(records.map(({ type }) => type), ["provider", "complete"]);
  assert.equal(records[0].raw_body, fastRaw);
  assert.deepEqual(records[1].structuredContent.providers.map(({ provider }) => provider), ["avioadsb"]);
});

test("MCP streams progress first, then one tool result with all raw bodies", { timeout: 5000 }, async (t) => {
  const { started, releaseSlow } = stubProviders(t);
  const request = new Request("https://test.example/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "aviation_lookup",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 42, method: "tools/call",
      params: {
        name: "aviation_lookup", arguments: args,
        _meta: {
          progressToken: "lookup-42",
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream\b/);
  const events = sseMessages(response.body);

  const first = (await events.next()).value;
  assert.equal(first.method, "notifications/progress");
  assert.equal(first.params.progressToken, "lookup-42");
  assert.equal(first.params.progress, 1);
  assert.deepEqual(started, new Set(["api.adsb.lol", "avioadsb.org"]));

  releaseSlow();
  const second = (await events.next()).value;
  assert.equal(second.method, "notifications/progress");
  assert.equal(second.params.progress, 2);
  const complete = (await events.next()).value;
  assert.equal(complete.id, 42);
  const { content, structuredContent } = complete.result;
  assert.deepEqual(new Set(structuredContent.providers.map(({ provider }) => provider)), new Set(args.providers));
  const sourceBodies = new Map(structuredContent.providers.map((source) => [source.provider, content[source.raw_body_content_index].text]));
  assert.equal(sourceBodies.get("avioadsb"), fastRaw);
  assert.equal(sourceBodies.get("adsb_lol"), slowRaw);
  assert.deepEqual(structuredContent.providers.find((source) => source.provider === "avioadsb").quota_headers, fastQuota);
  assert.equal((await events.next()).done, true);
});

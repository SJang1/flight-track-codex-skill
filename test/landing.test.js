import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import worker from '../src/index.js';

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.handlers = new Map();
    this.dataset = {};
    this.textContent = '';
  }

  set value(value) { this.explicitValue = String(value); }
  get value() { return this.explicitValue ?? this.children.find((child) => child.tagName === 'OPTION')?.value ?? ''; }
  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  addEventListener(type, handle) { this.handlers.set(type, handle); }
  dispatch(type) { return this.handlers.get(type)?.({ target: this, preventDefault() {} }); }

  descendants() {
    return this.children.filter((child) => child instanceof Element).flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector) {
    const tags = selector.split(',').map((part) => part.trim().toUpperCase());
    return this.descendants().filter((child) => tags.includes(child.tagName) || (tags.includes('[NAME]') && child.name));
  }
}

test('website groups provider endpoints and submits typed requests through the lookup stream', async (t) => {
  const origin = 'https://test.example';
  const env = {
    AERODATABOX_API_KEY: 'aerodatabox-credential-fixture',
    AIRLABS_API_KEY: 'airlabs-credential-fixture',
    INCHEON_PASSENGER_SERVICE_KEY: 'incheon-credential-fixture',
    FLIGHTRADAR24_API_KEY: 'fr24-credential-fixture',
    FLIGHTRADAR24_PLAN: 'explorer',
  };
  const page = await worker.fetch(new Request(origin), env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<option value="native">공급자별 전체 엔드포인트<\/option>/);
  assert.doesNotMatch(html, /<option value="(?:fr24|aerodatabox)">/);
  for (const [name, key] of Object.entries(env)) {
    if (name.endsWith('_KEY')) assert.ok(!html.includes(key), 'credential cannot appear in the webpage');
  }

  const elements = [...html.matchAll(/<([\w-]+)\b([^>]*\bid="([\w-]+)"[^>]*)>/g)].map(([, tag, attrs, id]) => {
    return Object.assign(new Element(tag), { id, name: attrs.match(/\bname="([\w-]+)"/)?.[1] });
  });
  const find = (id) => elements.flatMap((node) => [node, ...node.descendants()]).find((node) => node.id === id);
  const choose = async (id, value) => {
    const select = find(id);
    select.value = value;
    await select.dispatch('change');
  };
  const optionFor = (id, value) => find(id).descendants().find((node) => node.tagName === 'OPTION' && node.value === value);
  const config = find('lookup-config');
  config.textContent = html.match(/<script\b[^>]*id="lookup-config"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.match(config.textContent, /"fr24_plan":"explorer"/);
  assert.match(config.textContent, /"historic_positions_full"/);
  assert.doesNotMatch(config.textContent, /credentials|missing_environment_variables/);

  const client = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const submitted = [];
  const upstream = [];
  const body = '{ "fixture": "원본 응답" }\n';
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  globalThis.fetch = async (url, options) => {
    upstream.push({ url: new URL(url), method: options.method, body: options.body });
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  };
  find('operation').value = 'flight';
  runInNewContext(client, {
    document: {
      querySelector: (selector) => find(selector.slice(1)),
      createElement: (tag) => new Element(tag),
    },
    AbortController, TextDecoderStream,
    fetch: async (path, options) => {
      assert.equal(path, '/lookup/stream');
      assert.equal(options.method, 'POST');
      submitted.push(JSON.parse(options.body));
      const response = await worker.fetch(new Request(origin + path, options), env);
      assert.match(response.headers.get('Content-Type'), /^application\/x-ndjson\b/);
      return response;
    },
  });

  find('field-ident').value = 'KE703';
  find('providers').value = 'airlabs, flightradar24';
  find('exclude-providers').value = 'flightradar24';
  await find('lookup').dispatch('submit');
  assert.deepEqual(submitted[0].providers, ['airlabs', 'flightradar24']);
  assert.deepEqual(submitted[0].excludeProviders, ['flightradar24']);
  assert.equal(submitted[0].ident, 'KE703');
  assert.equal(submitted[0].identType, 'flight_number');
  assert.equal(upstream[0].url.hostname, 'airlabs.co');
  assert.ok(find('results').descendants().some((node) => node.textContent === body));

  find('operation').value = 'route';
  await find('operation').dispatch('change');
  assert.equal(find('field-airport').required, true);
  assert.equal(find('field-oppositeAirport').required, true);
  assert.equal(find('field-date').required, false);
  assert.equal(find('field-page').required, false);
  find('field-airport').value = 'ICN';
  find('field-oppositeAirport').value = 'NRT';
  find('providers').value = 'incheon_passenger_detail';
  find('exclude-providers').value = '';
  await find('lookup').dispatch('submit');
  assert.equal(submitted[1].operation, 'airport');
  assert.equal(submitted[1].airport, 'ICN');
  assert.equal(submitted[1].oppositeAirport, 'NRT');
  assert.equal(submitted[1].direction, 'departure');
  assert.equal(upstream[1].url.searchParams.get('airport_code'), 'NRT');

  await choose('operation', 'native');
  assert.equal(find('provider-fieldset').hidden, true);
  assert.equal(find('submit').disabled, true);
  assert.ok(optionFor('native-provider', 'flightradar24'));
  assert.ok(optionFor('native-provider', 'aerodatabox'));
  assert.ok(optionFor('native-provider', 'airlabs'));
  assert.equal(find('fr24-endpoint'), undefined);
  assert.equal(find('aerodatabox-endpoint'), undefined);
  await choose('native-provider', 'flightradar24');
  assert.equal(optionFor('native-endpoint', 'flight_summary_count').disabled, true);
  await choose('native-endpoint', 'historic_positions_full');
  assert.equal(find('native-method').textContent, 'GET');
  assert.equal(find('native-path-value').textContent, '/api/historic/flight-positions/full');
  assert.equal(find('fr24-timestamp').step, '1');
  const timestamp = Math.floor(Date.now() / 1000) - 60;
  find('fr24-timestamp').value = new Date(timestamp * 1000).toISOString().slice(0, 19);
  find('fr24-limit').value = 3;
  await find('lookup').dispatch('submit');
  assert.equal(submitted[2].operation, 'fr24');
  assert.equal(submitted[2].fr24Endpoint, 'historic_positions_full');
  assert.equal(submitted[2].providers, undefined);
  assert.equal(submitted[2].fr24Params.timestamp, timestamp);
  assert.equal(submitted[2].fr24Params.limit, 3);
  assert.equal(upstream[2].url.pathname, '/api/historic/flight-positions/full');
  assert.equal(upstream[2].url.searchParams.get('timestamp'), String(timestamp));

  await choose('native-endpoint', 'airports_light');
  assert.ok(find('fr24-code').required);
  find('operation').value = 'flight';
  await find('operation').dispatch('change');
  assert.equal(find('fr24-code'), undefined);
  find('field-ident').value = 'KE703';
  find('providers').value = 'aviationstack';
  await find('lookup').dispatch('submit');
  assert.equal(upstream.length, 3);
  assert.ok(find('results').descendants().some((node) => node.textContent === 'Aviationstack · 키 없음'));

  find('operation').value = 'airport_info';
  await find('operation').dispatch('change');
  assert.equal(find('field-airport').required, true);
  find('field-airport').value = 'ICN';
  find('providers').value = 'freeairportdb';
  await find('lookup').dispatch('submit');
  assert.deepEqual(submitted[4], { operation: 'airport_info', airport: 'ICN', providers: ['freeairportdb'] });
  assert.equal(upstream[3].url.pathname, '/v1/airports/ICN');

  await choose('operation', 'native');
  await choose('native-provider', 'aerodatabox');
  await choose('native-endpoint', 'GetAirport');
  assert.equal(find('aerodatabox-code').required, true);
  find('aerodatabox-codeType').value = 'Iata';
  find('aerodatabox-code').value = 'ICN';
  find('aerodatabox-withRunways').value = 'false';
  await find('lookup').dispatch('submit');
  assert.deepEqual(submitted.at(-1), {
    operation: 'aerodatabox', aerodataBoxEndpoint: 'GetAirport',
    aerodataBoxParams: { codeType: 'Iata', code: 'ICN', withRunways: false },
  });
  assert.equal(upstream.at(-1).url.pathname, '/airports/Iata/ICN');
  assert.equal(upstream.at(-1).url.searchParams.get('withRunways'), 'false');

  await choose('native-endpoint', 'RefillBalance');
  assert.equal(find('native-method').textContent, 'POST');
  assert.equal(find('native-confirmation').hidden, false);
  find('aerodatabox-body-credits').value = 3;
  const previouslySubmitted = submitted.length;
  await find('lookup').dispatch('submit');
  assert.equal(submitted.length, previouslySubmitted);
  find('native-confirm').checked = true;
  await find('native-confirm').dispatch('change');
  await find('lookup').dispatch('submit');
  assert.equal(submitted.length, previouslySubmitted + 1);
  assert.deepEqual(submitted.at(-1), {
    operation: 'aerodatabox', aerodataBoxEndpoint: 'RefillBalance', aerodataBoxParams: {},
    aerodataBoxBody: { credits: 3 }, confirmAeroDataBoxChange: true,
  });
  assert.equal(upstream.at(-1).url.pathname, '/subscriptions/balance/refill');
  assert.equal(upstream.at(-1).method, 'POST');
  assert.deepEqual(JSON.parse(upstream.at(-1).body), { credits: 3 });
  assert.equal(find('native-confirm').checked, false);
  assert.equal(find('submit').disabled, true);

  await choose('native-provider', 'airlabs');
  await choose('native-endpoint', 'nearby');
  assert.equal(find('native-confirmation').hidden, true);
  assert.equal(find('aerodatabox-body-credits'), undefined);
  assert.equal(find('native-param-lat').required, true);
  find('native-param-lat').value = 0;
  find('native-param-lng').value = 126.3;
  find('native-param-distance').value = 12;
  find('native-response-format').value = 'csv';
  await find('lookup').dispatch('submit');
  assert.deepEqual(submitted.at(-1), {
    operation: 'native', nativeProvider: 'airlabs', nativeEndpoint: 'nearby',
    nativeParams: { lat: 0, lng: 126.3, distance: 12 }, format: 'csv',
  });
  assert.equal(upstream.at(-1).url.pathname, '/api/v9/nearby.csv');

  await choose('native-endpoint', 'listen');
  assert.equal(find('native-method').textContent, 'GET');
  assert.equal(find('native-confirmation').hidden, false);
  assert.equal(find('submit').disabled, true);
  const callback = 'https://example.invalid/alerts';
  find('native-param-webhook_url').value = callback;
  find('native-confirm').checked = true;
  await find('native-confirm').dispatch('change');
  await find('lookup').dispatch('submit');
  assert.deepEqual(submitted.at(-1), {
    operation: 'native', nativeProvider: 'airlabs', nativeEndpoint: 'listen',
    nativeParams: { webhook_url: callback }, confirmNativeChange: true,
  });
  assert.equal(upstream.at(-1).url.pathname, '/api/v9/listen');
  assert.equal(upstream.at(-1).url.searchParams.get('webhook_url'), callback);
  assert.equal(find('native-confirm').checked, false);
  assert.equal(find('submit').disabled, true);
});

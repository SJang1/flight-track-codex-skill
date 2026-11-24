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

test('website form submits typed inputs and displays raw results from the lookup stream', async (t) => {
  const origin = 'https://test.example';
  const env = {
    AIRLABS_API_KEY: 'airlabs-credential-fixture',
    INCHEON_PASSENGER_SERVICE_KEY: 'incheon-credential-fixture',
    FLIGHTRADAR24_API_KEY: 'fr24-credential-fixture',
    FLIGHTRADAR24_PLAN: 'essential',
  };
  const page = await worker.fetch(new Request(origin), env);
  assert.equal(page.status, 200);
  const html = await page.text();
  for (const [name, key] of Object.entries(env)) {
    if (name.endsWith('_KEY')) assert.ok(!html.includes(key), 'credential cannot appear in the webpage');
  }

  const elements = [...html.matchAll(/<([\w-]+)\b([^>]*\bid="([\w-]+)"[^>]*)>/g)].map(([, tag, attrs, id]) => {
    return Object.assign(new Element(tag), { id, name: attrs.match(/\bname="([\w-]+)"/)?.[1] });
  });
  const find = (id) => elements.flatMap((node) => [node, ...node.descendants()]).find((node) => node.id === id);
  const config = find('lookup-config');
  config.textContent = html.match(/<script\b[^>]*id="lookup-config"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.match(config.textContent, /"fr24_plan":"essential"/);
  assert.match(config.textContent, /"historic_positions_full"/);
  assert.doesNotMatch(config.textContent, /credentials|missing_environment_variables/);

  const client = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const submitted = [];
  const upstream = [];
  const body = '{ "fixture": "원본 응답" }\n';
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  globalThis.fetch = async (url) => {
    upstream.push(new URL(url));
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
  assert.equal(upstream[0].hostname, 'airlabs.co');
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
  assert.equal(upstream[1].searchParams.get('airport_code'), 'NRT');

  find('operation').value = 'fr24';
  await find('operation').dispatch('change');
  assert.equal(find('provider-fieldset').hidden, true);
  find('fr24-endpoint').value = 'historic_positions_full';
  await find('fr24-endpoint').dispatch('change');
  assert.equal(find('fr24-timestamp').step, '1');
  const timestamp = Math.floor(Date.now() / 1000) - 60;
  find('fr24-timestamp').value = new Date(timestamp * 1000).toISOString().slice(0, 19);
  find('fr24-limit').value = 3;
  await find('lookup').dispatch('submit');
  assert.equal(submitted[2].fr24Endpoint, 'historic_positions_full');
  assert.equal(submitted[2].providers, undefined);
  assert.equal(submitted[2].fr24Params.timestamp, timestamp);
  assert.equal(submitted[2].fr24Params.limit, 3);
  assert.equal(upstream[2].pathname, '/api/historic/flight-positions/full');
  assert.equal(upstream[2].searchParams.get('timestamp'), String(timestamp));

  find('fr24-endpoint').value = 'airports_light';
  await find('fr24-endpoint').dispatch('change');
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
  assert.equal(upstream[3].pathname, '/v1/airports/ICN');
});

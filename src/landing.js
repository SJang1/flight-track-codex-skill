export const landing = (providerIds, fr24Catalog = {}, fr24ParamProperties = {}) => {
  const config = JSON.stringify({
    providerIds, ...fr24Catalog, fr24ParamProperties,
  }).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aviation Raw Tracker</title>
<style>
  :root { color-scheme: light; --ink: #192739; --muted: #586777; --line: #dce4eb; --surface: #fff; --blue: #174d83; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: #f2f5f8; color: var(--ink); font: 1rem/1.55 system-ui, sans-serif; }
  main { width: min(100% - 2rem, 74rem); margin: 0 auto 3rem; }
  .page-header { padding: clamp(2rem, 5vw, 4rem) 0 1.75rem; }
  h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.35rem); line-height: 1.06; letter-spacing: -.06em; }
  h2 { margin: 0; font-size: 1.35rem; letter-spacing: -.02em; }
  p { margin: .45rem 0 0; }
  .muted, small { color: var(--muted); }
  .workspace { display: grid; grid-template-columns: minmax(0, 1.13fr) minmax(0, 1fr); gap: 1rem; align-items: start; }
  .panel { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: .85rem; box-shadow: 0 4px 18px #243d5310; }
  .panel-header, form, #results { padding: 1.1rem 1.25rem; }
  .panel-header { border-bottom: 1px solid var(--line); }
  .method { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; margin-top: .65rem; font: .88rem/1.45 ui-monospace, monospace; overflow-wrap: anywhere; }
  .post, .get { padding: .18rem .45rem; border-radius: .3rem; font-size: .73rem; font-weight: 750; letter-spacing: .05em; }
  .post { color: #154270; background: #e1eefd; }
  .get { color: #145b4a; background: #dbf3eb; }
  .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .9rem; }
  .field-grid:not(:empty) { margin-top: .95rem; }
  label { display: block; margin-bottom: .3rem; font-weight: 650; font-size: .93rem; }
  input, select { width: 100%; min-height: 2.65rem; padding: .45rem .58rem; border: 1px solid #aebcca; border-radius: .4rem; background: #fff; color: inherit; font: inherit; }
  button, summary { cursor: pointer; }
  :focus-visible { outline: 3px solid #2675bb; outline-offset: 2px; }
  .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.1rem; }
  button { padding: .5rem .9rem; border: 1px solid var(--blue); border-radius: .42rem; background: var(--blue); color: white; font: inherit; font-weight: 650; }
  button + button { background: white; color: var(--blue); }
  button:disabled { opacity: .55; cursor: default; }
  details { margin-top: .85rem; padding: .55rem .7rem; border: 1px solid var(--line); border-radius: .45rem; }
  summary { font-weight: 650; overflow-wrap: anywhere; }
  .provider-fieldset { min-width: 0; margin: 1rem 0 0; padding: .6rem .8rem .8rem; border: 1px solid var(--line); border-radius: .45rem; }
  legend { padding: 0 .3rem; font-weight: 650; }
  .provider-fieldset .field-grid { margin-top: 0; }
  .provider-fieldset small { display: block; margin-top: .45rem; }
  pre { overflow: auto; max-height: 26rem; margin: .65rem 0 0; padding: .65rem; border-radius: .4rem; background: #f2f5f8; white-space: pre-wrap; overflow-wrap: anywhere; font: .84rem/1.5 ui-monospace, monospace; }
  code { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  #status[data-error] { color: #a12828; }
  #results:empty { display: none; }
  #results details:first-child { margin-top: 0; }
  @media (max-width: 52rem) { .workspace { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 29rem) { .field-grid { grid-template-columns: minmax(0, 1fr); } .panel-header, form, #results { padding-inline: .9rem; } }
</style>
</head>
<body>
<main>
  <header class="page-header">
    <h1>Aviation Raw Tracker</h1>
    <p class="muted">항공편, 공항 운항, 실시간 위치를 조회하고 공급자별 원본 응답을 확인하세요.</p>
  </header>
  <div class="workspace">
    <section class="panel" aria-labelledby="request-heading">
      <header class="panel-header">
        <h2 id="request-heading">직접 조회</h2>
        <div class="method"><span class="post">POST</span><code>/lookup/stream</code></div>
      </header>
      <form id="lookup">
        <label for="operation">요청 유형</label>
        <select id="operation">
          <option value="flight">항공편 상태</option>
          <option value="live">실시간 위치</option>
          <option value="track">비행 궤적</option>
          <option value="history">과거 운항</option>
          <option value="airport">공항 출도착</option>
          <option value="route">운항 구간</option>
          <option value="schedule">운항 일정</option>
          <option value="fr24">Flightradar24 엔드포인트</option>
        </select>
        <div id="fields" class="field-grid"></div>
        <div id="fr24" hidden>
          <div class="field-grid">
            <div>
              <label for="fr24-endpoint">FR24 엔드포인트</label>
              <select id="fr24-endpoint"></select>
            </div>
          </div>
          <div id="fr24-path" class="method" hidden><span class="get">GET</span><code id="fr24-path-value"></code></div>
          <p id="fr24-note" class="muted"></p>
          <div id="fr24-fields" class="field-grid"></div>
        </div>
        <details id="additional" hidden>
          <summary>추가 조건</summary>
          <div id="additional-fields" class="field-grid"></div>
        </details>
        <fieldset id="provider-fieldset" class="provider-fieldset">
          <legend>공급자</legend>
          <div class="field-grid">
            <div>
              <label for="providers">이 공급자만 조회</label>
              <input id="providers" name="providers" list="provider-options" placeholder="예: adsb_fi, avioadsb" autocomplete="off" spellcheck="false" aria-describedby="provider-help">
            </div>
            <div>
              <label for="exclude-providers">이 공급자 제외</label>
              <input id="exclude-providers" name="excludeProviders" list="provider-options" placeholder="예: opensky" autocomplete="off" spellcheck="false" aria-describedby="provider-help">
            </div>
          </div>
          <small id="provider-help">ID를 쉼표로 구분합니다. 양쪽에 있는 공급자는 제외됩니다.</small>
          <datalist id="provider-options"></datalist>
        </fieldset>
        <div class="actions"><button id="submit" type="submit">요청 보내기</button><button id="cancel" type="button" disabled>중단</button></div>
        <details>
          <summary>요청 본문 보기</summary>
          <pre id="request-preview"></pre>
        </details>
      </form>
    </section>
    <section class="panel" aria-labelledby="response-heading">
      <header class="panel-header">
        <h2 id="response-heading">응답</h2>
        <p id="status" class="muted" role="status" aria-live="polite">요청을 보내면 공급자별 원본 응답이 도착 순서대로 표시됩니다.</p>
      </header>
      <div id="results" aria-label="공급자 원본 응답"></div>
    </section>
  </div>
</main>
<script id="lookup-config" type="application/json">${config}</script>
<script type="module">
  const config = JSON.parse(document.querySelector('#lookup-config').textContent);
  const form = document.querySelector('#lookup');
  const operation = document.querySelector('#operation');
  const fields = document.querySelector('#fields');
  const additional = document.querySelector('#additional');
  const additionalFields = document.querySelector('#additional-fields');
  const fr24 = document.querySelector('#fr24');
  const fr24Endpoint = document.querySelector('#fr24-endpoint');
  const fr24Fields = document.querySelector('#fr24-fields');
  const fr24Path = document.querySelector('#fr24-path');
  const fr24PathValue = document.querySelector('#fr24-path-value');
  const fr24Note = document.querySelector('#fr24-note');
  const providerFieldset = document.querySelector('#provider-fieldset');
  const providerFields = [document.querySelector('#providers'), document.querySelector('#exclude-providers')];
  const providerOptions = document.querySelector('#provider-options');
  const requestPreview = document.querySelector('#request-preview');
  const results = document.querySelector('#results');
  const status = document.querySelector('#status');
  const submit = document.querySelector('#submit');
  const cancel = document.querySelector('#cancel');
  const endpoints = config.fr24_endpoints ?? [];
  let active;
  let received = 0;
  const skipReasons = {
    missing_credentials: '키 없음', select_individually: '단독 선택 필요', unsupported_operation: '조회 유형 미지원',
    unsupported_input: '입력 조건 미지원', unsupported_format: '응답 형식 미지원', provider_processing_error: '요청 준비 실패',
  };

  const identifiers = [
    ['flight_number', '편명'], ['iata', 'IATA 편명'], ['icao', 'ICAO 편명'],
    ['callsign', '호출부호'], ['registration', '기체 등록번호'], ['icao24', 'ICAO 24비트 주소'],
    ['provider_id', '공급자 식별자'],
  ];
  const direction = { label: '출도착 구분', options: [['', '전체'], ['departure', '출발'], ['arrival', '도착']] };
  const dateRange = ['date', 'start', 'end'];
  const paging = ['page', 'limit', 'cursor'];
  const fieldSpecs = {
    identType: { label: '식별자 유형', options: identifiers },
    ident: { label: '식별자', required: true, maxLength: 160 },
    callsign: { label: '확인된 ADS-B 콜사인', placeholder: 'KAL703', maxLength: 8 },
    icao24: { label: '확인된 ICAO 24비트 주소', placeholder: '71C597', pattern: '[A-Fa-f0-9]{6}' },
    registration: { label: '확인된 기체 등록번호', maxLength: 12 },
    airport: { label: '공항 코드', placeholder: 'ICN', pattern: '[A-Za-z0-9]{3,4}' },
    oppositeAirport: { label: '상대 공항 코드', placeholder: 'NRT', pattern: '[A-Za-z0-9]{3,4}' },
    date: { label: '조회 날짜', type: 'date' },
    start: { label: '시작 시각 (UTC)', type: 'datetime-local' },
    end: { label: '종료 시각 (UTC)', type: 'datetime-local' },
    direction,
    market: { label: '노선 구분', options: [['', '전체'], ['domestic', '국내선'], ['international', '국제선']] },
    format: { label: '응답 형식', options: [['', '공급자 기본값'], ['json', 'JSON'], ['xml', 'XML']] },
    fromTime: { label: '공항 현지 시작 시각 (HHmm)', placeholder: '0900', pattern: '[0-9]{4}' },
    toTime: { label: '공항 현지 종료 시각 (HHmm)', placeholder: '1800', pattern: '[0-9]{4}' },
    page: { label: '페이지', type: 'number', minimum: 1, maximum: 100 },
    limit: { label: '최대 결과 수', type: 'number', minimum: 1, maximum: 100 },
    cursor: { label: '페이지 커서', maxLength: 2048 },
  };
  const forms = {
    flight: { fields: ['identType', 'ident'], example: 'KE703', optional: ['airport', 'oppositeAirport', 'direction', 'callsign', 'icao24', 'registration', ...dateRange, ...paging, 'format'] },
    live: { fields: ['identType', 'ident'], identType: 'callsign', example: 'KAL93', optional: ['limit', 'format'] },
    track: { fields: ['identType', 'ident'], identType: 'icao24', example: '71C597', optional: [...dateRange, ...paging, 'format'] },
    history: { fields: ['identType', 'ident'], identType: 'icao24', example: '71C597', optional: [...dateRange, ...paging, 'format'] },
    airport: { fields: ['airport', 'direction'], optional: [...dateRange, 'fromTime', 'toTime', 'market', ...paging, 'format'] },
    route: { fields: ['airport', 'oppositeAirport'], optional: [...dateRange, 'fromTime', 'toTime', 'market', ...paging, 'format'] },
    schedule: { fields: ['airport', 'direction', 'date', 'market'], optional: ['ident', 'oppositeAirport', 'fromTime', 'toTime', ...paging, 'format'] },
  };
  const endpointNames = {
    airports_light: '공항 정보 (Light)', airports_full: '공항 정보 (Full)', airlines_light: '항공사 정보',
    live_positions_full: '실시간 위치 (Full)', live_positions_light: '실시간 위치 (Light)', live_positions_count: '실시간 위치 건수',
    historic_positions_full: '과거 위치 (Full)', historic_positions_light: '과거 위치 (Light)', historic_positions_count: '과거 위치 건수',
    historic_events_full: '과거 운항 이벤트 (Full)', historic_events_light: '과거 운항 이벤트 (Light)', historic_events_count: '과거 운항 이벤트 건수',
    flight_summary_full: '운항 요약 (Full)', flight_summary_light: '운항 요약 (Light)', flight_summary_count: '운항 요약 건수',
    flight_tracks: '비행 궤적', usage: '계정 사용량',
  };
  const nativeSpecs = {
    code: { label: '공항 코드', placeholder: 'ICN' },
    icao: { label: '항공사 ICAO 코드', placeholder: 'KAL' },
    flight_id: { label: 'FR24 항공편 ID', placeholder: '3a55c027' },
    flight_ids: { label: 'FR24 항공편 ID 목록', placeholder: '3a55c027,38a384da' },
    flights: { label: '편명 목록', placeholder: 'KE703,KE704' },
    callsigns: { label: '호출부호 목록', placeholder: 'KAL703' },
    registrations: { label: '기체 등록번호 목록' },
    airports: { label: '공항 목록', placeholder: 'ICN,NRT' },
    routes: { label: '운항 구간 목록', placeholder: 'ICN-NRT' },
    aircraft: { label: '기종 목록' },
    timestamp: { label: '관측 시각 (UTC)', type: 'datetime-local', valueType: 'timestamp' },
    flight_datetime_from: { label: '조회 시작 시각 (UTC)', type: 'datetime-local' },
    flight_datetime_to: { label: '조회 종료 시각 (UTC)', type: 'datetime-local' },
    limit: { label: '최대 결과 수', type: 'number', minimum: 1, maximum: 30000 },
    period: { label: '집계 기간', options: [['', '기본값 (24시간)'], ['24h', '24시간'], ['7d', '7일'], ['30d', '30일'], ['1y', '1년']] },
    sort: { label: '정렬', options: [['', '기본값'], ['asc', '오름차순'], ['desc', '내림차순']] },
    event_types: { label: '이벤트 유형', placeholder: 'takeoff,landed' },
  };
  const nativePrimary = new Set(['code', 'icao', 'flight_id', 'flight_ids', 'flights', 'callsigns', 'registrations', 'airports', 'routes', 'timestamp', 'flight_datetime_from', 'flight_datetime_to', 'limit', 'period']);

  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  for (const id of config.providerIds) providerOptions.append(option(id, id));
  for (const endpoint of endpoints) {
    const name = endpointNames[endpoint.id] ?? endpoint.id;
    const blocked = endpoint.available_on_plan === false;
    const element = option(endpoint.id, blocked ? name + ' · 현재 플랜에서 사용 불가' : name);
    element.disabled = blocked;
    fr24Endpoint.append(element);
  }
  fr24Endpoint.value = endpoints.find((endpoint) => endpoint.available_on_plan !== false)?.id ?? '';

  function createField(name, spec, prefix) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    const input = document.createElement(spec.options ? 'select' : 'input');
    input.id = prefix + name;
    input.name = name;
    input.required = Boolean(spec.required);
    label.htmlFor = input.id;
    label.textContent = spec.label + (spec.required ? ' *' : '');
    if (spec.options) {
      input.append(...spec.options.map(([value, title]) => option(value, title)));
    } else {
      input.type = spec.type ?? 'text';
      if (input.type === 'datetime-local') input.step = '1';
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (spec.placeholder) input.placeholder = spec.placeholder;
      if (spec.pattern) input.pattern = spec.pattern;
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.minimum != null) input.min = String(spec.minimum);
      if (spec.maximum != null) input.max = String(spec.maximum);
    }
    if (spec.valueType) input.dataset.valueType = spec.valueType;
    if (spec.value) input.value = spec.value;
    wrapper.append(label, input);
    return wrapper;
  }

  function genericField(mode, name) {
    const spec = { ...fieldSpecs[name] };
    if (name === 'identType') spec.value = forms[mode].identType ?? 'flight_number';
    if (name === 'ident') spec.placeholder = forms[mode].example;
    if (name === 'ident' && mode === 'schedule') Object.assign(spec, { label: '편명', placeholder: 'KE123', required: false });
    if (mode === 'route' && (name === 'airport' || name === 'oppositeAirport')) {
      spec.label = name === 'airport' ? '출발 공항 코드' : '도착 공항 코드';
      spec.required = true;
    }
    return createField(name, spec, 'field-');
  }

  function nativeField(endpoint, name) {
    const schema = config.fr24ParamProperties[name] ?? {};
    const spec = {
      ...schema,
      label: name,
      type: schema.type === 'integer' ? 'number' : 'text',
      options: schema.enum?.map((value) => [value, value]),
      ...nativeSpecs[name],
      required: endpoint.required_parameters.includes(name),
    };
    return createField(name, spec, 'fr24-');
  }

  const selectedEndpoint = () => endpoints.find(({ id }) => id === fr24Endpoint.value);

  function showOptional(items) {
    additionalFields.replaceChildren(...items);
    additional.hidden = items.length === 0;
  }

  function showNativeFields() {
    const endpoint = selectedEndpoint();
    fr24Path.hidden = !endpoint;
    fr24PathValue.textContent = endpoint?.path ?? '';
    fr24Note.textContent = endpoint ? '공급자 Flightradar24' + (config.fr24_plan ? ' · 플랜 ' + config.fr24_plan : '') : '조회할 수 있는 FR24 엔드포인트가 없습니다.';
    const primary = endpoint?.parameters.filter((name) => nativePrimary.has(name) || endpoint.required_parameters.includes(name)) ?? [];
    const secondary = endpoint?.parameters.filter((name) => !primary.includes(name)) ?? [];
    fr24Fields.replaceChildren(...primary.map((name) => nativeField(endpoint, name)));
    showOptional(secondary.map((name) => nativeField(endpoint, name)));
  }

  function updateActions() {
    submit.disabled = Boolean(active) || (operation.value === 'fr24' && !selectedEndpoint());
    cancel.disabled = !active;
  }

  function showOperation() {
    const mode = operation.value;
    fr24.hidden = mode !== 'fr24';
    providerFieldset.hidden = mode === 'fr24';
    fields.replaceChildren();
    additional.open = false;
    if (mode === 'fr24') {
      showNativeFields();
    } else {
      fr24Fields.replaceChildren();
      const current = forms[mode];
      fields.append(...current.fields.map((name) => genericField(mode, name)));
      showOptional(current.optional.map((name) => genericField(mode, name)));
    }
    updateActions();
    updatePreview();
  }

  function fieldValues(container) {
    const values = {};
    for (const field of container.querySelectorAll('input, select')) {
      let value = field.value.trim();
      if (!value) continue;
      if (field.type === 'number') value = Number(value);
      if (field.type === 'datetime-local') {
        value += value.length === 16 ? ':00Z' : 'Z';
        if (field.dataset.valueType === 'timestamp') value = Math.floor(Date.parse(value) / 1000);
      }
      values[field.name] = value;
    }
    return values;
  }

  function readRequest() {
    const mode = operation.value;
    if (mode === 'fr24') {
      return {
        operation: 'fr24',
        fr24Endpoint: fr24Endpoint.value,
        fr24Params: { ...fieldValues(fr24Fields), ...fieldValues(additionalFields) },
      };
    }
    const input = { operation: mode === 'route' ? 'airport' : mode, ...fieldValues(fields), ...fieldValues(additionalFields) };
    if (mode === 'route') input.direction = 'departure';
    for (const field of providerFields) {
      const values = field.value.split(',').map((id) => id.trim()).filter(Boolean);
      if (values.length) input[field.name] = values;
    }
    return input;
  }

  function updatePreview() {
    requestPreview.textContent = JSON.stringify(readRequest(), null, 2);
  }

  function addResult(label, value, open = false) {
    const panel = document.createElement('details');
    const heading = document.createElement('summary');
    const body = document.createElement('pre');
    panel.open = open;
    heading.textContent = label;
    body.textContent = value;
    panel.append(heading, body);
    results.append(panel);
  }

  function render(record) {
    if (record.type === 'error') throw new Error(record.message);
    if (record.type === 'provider') {
      const source = record.source;
      if (!source.upstream_attempted) return;
      const code = source.http_status ? ' · HTTP ' + source.http_status : '';
      received += 1;
      const kind = source.airport_code ? ' · 공항 정보 ' + source.airport_code
        : source.result_kind === 'aircraft_position' ? ' · 기체 위치' : '';
      addResult(source.label + kind + ' · ' + source.status + code, record.raw_body ?? JSON.stringify(source, null, 2), received === 1);
      status.textContent = received + '개 공급자 처리 결과 수신';
    }
    if (record.type === 'complete') {
      const skipped = record.structuredContent.providers.filter((source) => source.upstream_attempted === false);
      status.textContent = received ? received + '개 공급자 조회 처리 완료.' : '조회 완료. 호출된 공급자가 없습니다.';
      if (skipped.length) {
        const reasons = skipped.map((source) => source.label + (source.airport_code ? ' (' + source.airport_code + ')' : '') + ' · ' + (skipReasons[source.status] ?? source.status));
        addResult('건너뛴 공급자 ' + skipped.length + '개', reasons.join('\\n'), !received);
      }
      addResult('조회 내역과 권장 재조회 시각', JSON.stringify(record.structuredContent, null, 2), !received && !skipped.length);
    }
  }

  operation.addEventListener('change', showOperation);
  fr24Endpoint.addEventListener('change', () => {
    showNativeFields();
    updateActions();
    updatePreview();
  });
  form.addEventListener('input', updatePreview);
  cancel.addEventListener('click', () => active?.abort());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (active || submit.disabled) return;
    const input = readRequest();
    results.replaceChildren();
    received = 0;
    status.removeAttribute('data-error');
    status.textContent = '조회 중…';
    const controller = new AbortController();
    active = controller;
    updateActions();
    try {
      const response = await fetch('/lookup/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      });
      if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        throw new Error('조회 응답을 열 수 없습니다. HTTP ' + response.status);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += value;
          const lines = pending.split('\\n');
          pending = lines.pop();
          for (const line of lines) if (line.trim()) render(JSON.parse(line));
        }
        if (pending.trim()) render(JSON.parse(pending));
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      status.textContent = controller.signal.aborted ? '조회를 중단했습니다.' : error.message;
      if (!controller.signal.aborted) status.setAttribute('data-error', '');
    } finally {
      active = null;
      updateActions();
    }
  });

  showOperation();
</script>
</body>
</html>`;
};

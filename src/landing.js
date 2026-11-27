export const landing = (providerIds, fr24Catalog = {}, fr24ParamProperties = {}, aerodataBoxCatalog = {}, nativeProviders = []) => {
  const config = JSON.stringify({
    providerIds, ...fr24Catalog, fr24ParamProperties, aerodatabox: aerodataBoxCatalog, nativeProviders,
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
  .endpoint-select { margin-top: .95rem; }
  .field-help { display: block; margin-top: .25rem; }
  .confirmation { display: flex; align-items: center; gap: .55rem; margin-top: .95rem; }
  .confirmation input { width: 1rem; min-height: 1rem; flex: none; }
  .confirmation label { margin: 0; }
  label { display: block; margin-bottom: .3rem; font-weight: 650; font-size: .93rem; }
  input, select, textarea { width: 100%; min-height: 2.65rem; padding: .45rem .58rem; border: 1px solid #aebcca; border-radius: .4rem; background: #fff; color: inherit; font: inherit; }
  textarea { resize: vertical; font-family: ui-monospace, monospace; }
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
          <option value="filed_route">제출 비행계획 경로</option>
          <option value="history">과거 운항</option>
          <option value="last_flight">기체의 마지막 운항</option>
          <option value="flight_dates">편명별 운항 날짜</option>
          <option value="airport">공항 출도착</option>
          <option value="route">운항 구간</option>
          <option value="schedule">운항 일정</option>
          <option value="aircraft">기체 상세 정보</option>
          <option value="aircraft_registrations">기체 등록 이력</option>
          <option value="airport_info">공항 기본 정보</option>
          <option value="airport_runways">공항 활주로</option>
          <option value="airline_info">항공사 기본 정보</option>
          <option value="nearby">반경 내 기체</option>
          <option value="native">공급자별 전체 엔드포인트</option>
        </select>
        <div id="fields" class="field-grid"></div>
        <div id="native" hidden>
          <div class="endpoint-select">
            <label for="native-provider">공급자</label>
            <select id="native-provider"></select>
          </div>
          <div class="endpoint-select">
            <label for="native-endpoint">엔드포인트</label>
            <select id="native-endpoint"></select>
          </div>
          <div id="native-path" class="method" hidden><span id="native-method" class="get"></span><code id="native-path-value"></code></div>
          <p class="muted"><span id="native-note"></span> <a id="native-docs" target="_blank" rel="noreferrer" hidden>공식 API 문서</a></p>
          <div id="native-fields" class="field-grid"></div>
          <div id="native-format" class="field-grid"></div>
          <div id="aerodatabox-body-fields" class="field-grid"></div>
          <div id="native-body-area" class="endpoint-select" hidden>
            <label id="native-body-label" for="native-body">요청 본문 (JSON)</label>
            <textarea id="native-body" rows="6" spellcheck="false" disabled></textarea>
            <details>
              <summary>본문 스키마</summary>
              <pre id="native-body-schema"></pre>
            </details>
          </div>
          <div id="native-confirmation" class="confirmation" hidden>
            <input id="native-confirm" type="checkbox">
            <label for="native-confirm">이 요청으로 계정을 변경하는 데 동의합니다.</label>
          </div>
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
          <small id="provider-help">기본 조회는 조건과 키가 맞는 공급자를 사용합니다. 공급자 ID는 쉼표로 구분합니다. 공급자 자체 식별자는 발급한 공급자 한 곳을 선택해야 합니다.</small>
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
  const aerodataBoxBodyFields = document.querySelector('#aerodatabox-body-fields');
  const native = document.querySelector('#native');
  const nativeProvider = document.querySelector('#native-provider');
  const nativeEndpoint = document.querySelector('#native-endpoint');
  const nativeFields = document.querySelector('#native-fields');
  const nativeFormat = document.querySelector('#native-format');
  const nativePath = document.querySelector('#native-path');
  const nativePathValue = document.querySelector('#native-path-value');
  const nativeMethod = document.querySelector('#native-method');
  const nativeNote = document.querySelector('#native-note');
  const nativeDocs = document.querySelector('#native-docs');
  const nativeBodyArea = document.querySelector('#native-body-area');
  const nativeBody = document.querySelector('#native-body');
  const nativeBodyLabel = document.querySelector('#native-body-label');
  const nativeBodySchema = document.querySelector('#native-body-schema');
  const nativeConfirmation = document.querySelector('#native-confirmation');
  const nativeConfirm = document.querySelector('#native-confirm');
  const providerFieldset = document.querySelector('#provider-fieldset');
  const providerFields = [document.querySelector('#providers'), document.querySelector('#exclude-providers')];
  const providerOptions = document.querySelector('#provider-options');
  const requestPreview = document.querySelector('#request-preview');
  const results = document.querySelector('#results');
  const status = document.querySelector('#status');
  const submit = document.querySelector('#submit');
  const cancel = document.querySelector('#cancel');
  let active;
  let received = 0;
  const skipReasons = {
    missing_credentials: '키 없음', select_individually: '단독 선택 필요', select_provider: '명시적 선택 필요', unsupported_operation: '조회 유형 미지원',
    unsupported_input: '입력 조건 미지원', unsupported_format: '응답 형식 미지원', provider_processing_error: '요청 준비 실패',
  };

  const identifiers = [
    ['flight_number', '편명'], ['iata', 'IATA 편명'], ['icao', 'ICAO 편명'],
    ['callsign', '호출부호'], ['registration', '기체 등록번호'], ['icao24', 'ICAO 24비트 주소'],
    ['aircraft_type', 'ICAO 기종 코드'], ['provider_id', '공급자 식별자'],
  ];
  const direction = { label: '출도착 구분', options: [['', '전체'], ['departure', '출발'], ['arrival', '도착']] };
  const dateRange = ['date', 'start', 'end'];
  const airportTime = ['fromTime', 'toTime', 'timeZone'];
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
    fromDate: { label: '출발일 시작', type: 'date', required: true },
    toDate: { label: '출발일 종료', type: 'date', required: true },
    start: { label: '시작 시각 (UTC)', type: 'datetime-local' },
    end: { label: '종료 시각 (UTC)', type: 'datetime-local' },
    direction,
    market: { label: '노선 구분', options: [['', '전체'], ['domestic', '국내선'], ['international', '국제선']] },
    format: { label: '응답 형식', options: [['', '공급자 기본값'], ['json', 'JSON'], ['xml', 'XML']] },
    fromTime: { label: '공항 현지 시작 시각', placeholder: '06:00', pattern: '[0-9]{2}:?[0-9]{2}' },
    toTime: { label: '공항 현지 종료 시각', placeholder: '10:00', pattern: '[0-9]{2}:?[0-9]{2}' },
    timeZone: { label: '공항 시간대 (IANA)', placeholder: '예: Asia/Seoul', maxLength: 64 },
    page: { label: '페이지', type: 'number', minimum: 1, maximum: 100 },
    limit: { label: '최대 결과 수', type: 'number', minimum: 1, maximum: 100 },
    cursor: { label: '페이지 커서', maxLength: 2048 },
    trackScope: { label: '궤적 범위', options: [['', '공급자 기본값'], ['recent', '최근'], ['full', '전체']] },
    latitude: { label: '위도', type: 'number', minimum: -90, maximum: 90, step: 'any', required: true },
    longitude: { label: '경도', type: 'number', minimum: -180, maximum: 180, step: 'any', required: true },
    radiusNm: { label: '반경 (해리)', type: 'number', minimum: 0, maximum: 250, step: 'any', required: true },
  };
  const forms = {
    flight: { fields: ['identType', 'ident'], example: 'KE703', optional: ['airport', 'oppositeAirport', 'direction', 'callsign', 'icao24', 'registration', ...dateRange, ...airportTime, ...paging, 'format'] },
    live: { fields: ['identType', 'ident'], identType: 'callsign', example: 'KAL93', optional: ['start', 'limit', 'format'] },
    track: { fields: ['identType', 'ident'], identType: 'icao24', example: '71C597', optional: ['trackScope', ...dateRange, ...paging, 'format'] },
    filed_route: { fields: ['identType', 'ident'], example: 'KE703', optional: [...dateRange, 'format'] },
    history: { fields: ['identType', 'ident'], identType: 'icao24', example: '71C597', optional: ['airport', 'oppositeAirport', 'direction', ...dateRange, ...airportTime, ...paging, 'format'] },
    last_flight: { fields: ['identType', 'ident'], identType: 'registration', identifyBy: ['registration'], example: 'HL8008', optional: ['format'] },
    flight_dates: { fields: ['identType', 'ident', 'fromDate', 'toDate'], example: 'KE703', optional: ['format'] },
    airport: { fields: ['airport', 'direction'], optional: [...dateRange, ...airportTime, 'market', ...paging, 'format'] },
    route: { fields: ['airport', 'oppositeAirport'], optional: [...dateRange, ...airportTime, 'market', ...paging, 'format'] },
    schedule: { fields: ['airport', 'direction', 'date', 'market'], optional: ['ident', 'oppositeAirport', ...airportTime, ...paging, 'format'] },
    aircraft: { fields: ['identType', 'ident'], identType: 'registration', identifyBy: ['registration', 'icao24', 'aircraft_type', 'provider_id'], example: 'HL8008', optional: ['format'] },
    aircraft_registrations: { fields: ['identType', 'ident'], identType: 'registration', identifyBy: ['registration', 'icao24', 'provider_id'], example: 'HL8008', optional: ['format'] },
    airport_info: { fields: ['airport'], optional: ['format'] },
    airport_runways: { fields: ['airport'], optional: ['format'] },
    airline_info: { fields: ['identType', 'ident'], identType: 'icao', identifyBy: ['iata', 'icao'], example: 'KAL', optional: ['format'] },
    nearby: { fields: ['latitude', 'longitude', 'radiusNm'], optional: ['limit', 'format'] },
  };
  const endpointNames = {
    airports_light: '공항 정보 (Light)', airports_full: '공항 정보 (Full)', airlines_light: '항공사 정보',
    live_positions_full: '실시간 위치 (Full)', live_positions_light: '실시간 위치 (Light)', live_positions_count: '실시간 위치 건수',
    historic_positions_full: '과거 위치 (Full)', historic_positions_light: '과거 위치 (Light)', historic_positions_count: '과거 위치 건수',
    historic_events_full: '과거 운항 이벤트 (Full)', historic_events_light: '과거 운항 이벤트 (Light)', historic_events_count: '과거 운항 이벤트 건수',
    flight_summary_full: '운항 요약 (Full)', flight_summary_light: '운항 요약 (Light)', flight_summary_count: '운항 요약 건수',
    flight_tracks: '비행 궤적', usage: '계정 사용량',
  };
  const nativeProviders = [
    {
      id: 'flightradar24', label: 'Flightradar24',
      docs: 'https://fr24api.flightradar24.com/docs/endpoints/overview',
      endpoints: (config.fr24_endpoints ?? []).map((endpoint) => ({ ...endpoint, label: endpointNames[endpoint.id] ?? endpoint.id })),
    },
    {
      id: 'aerodatabox', label: 'AeroDataBox Direct',
      docs: 'https://doc.aerodatabox.com/direct.html', endpoints: config.aerodatabox.endpoints ?? [],
    },
    ...config.nativeProviders,
  ].filter(({ endpoints }) => endpoints.length).sort((a, b) => a.label.localeCompare(b.label));
  const fr24Specs = {
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
  const fr24Primary = new Set(['code', 'icao', 'flight_id', 'flight_ids', 'flights', 'callsigns', 'registrations', 'airports', 'routes', 'timestamp', 'flight_datetime_from', 'flight_datetime_to', 'limit', 'period']);

  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  for (const id of config.providerIds) providerOptions.append(option(id, id));
  nativeProvider.append(option('', '공급자를 선택하세요'));
  for (const provider of nativeProviders) nativeProvider.append(option(provider.id, provider.label));
  nativeProvider.value = '';

  function setEndpointOptions(entries, previousId) {
    nativeEndpoint.replaceChildren();
    const available = entries.filter((endpoint) => endpoint.available_on_plan !== false);
    const selected = available.find(({ id }) => id === previousId) ?? available.find((endpoint) => (endpoint.method ?? 'GET') === 'GET' && !endpoint.changes_account);
    if (!selected) nativeEndpoint.append(option('', '엔드포인트를 선택하세요'));
    const groups = new Map();
    for (const endpoint of entries) {
      const { tag } = endpoint;
      if (tag && !groups.has(tag)) {
        const group = document.createElement('optgroup');
        group.label = tag;
        nativeEndpoint.append(group);
        groups.set(tag, group);
      }
      const method = endpoint.method ?? 'GET';
      const label = endpoint.label ?? endpoint.shortSummary ?? endpoint.id;
      const blocked = endpoint.available_on_plan === false;
      const element = option(endpoint.id, method + ' · ' + label + (blocked ? ' · 현재 플랜에서 사용 불가' : ''));
      element.disabled = blocked;
      (groups.get(tag) ?? nativeEndpoint).append(element);
    }
    nativeEndpoint.value = selected?.id ?? '';
    nativeEndpoint.disabled = !available.length;
  }

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
      if (spec.step) input.step = spec.step;
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (spec.placeholder) input.placeholder = spec.placeholder;
      if (spec.pattern) input.pattern = spec.pattern;
      if (spec.minLength != null) input.minLength = spec.minLength;
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.minimum != null) input.min = String(spec.minimum);
      if (spec.maximum != null) input.max = String(spec.maximum);
    }
    if (spec.valueType) input.dataset.valueType = spec.valueType;
    if (spec.value) input.value = spec.value;
    wrapper.append(label, input);
    if (spec.help) {
      const help = document.createElement('small');
      help.id = input.id + '-help';
      help.className = 'field-help';
      help.textContent = spec.help;
      input.setAttribute('aria-describedby', help.id);
      wrapper.append(help);
    }
    return wrapper;
  }

  function genericField(mode, name) {
    const spec = { ...fieldSpecs[name] };
    if (name === 'identType') spec.value = forms[mode].identType ?? 'flight_number';
    if (name === 'identType' && forms[mode].identifyBy) {
      spec.options = identifiers.filter(([value]) => forms[mode].identifyBy.includes(value)).map(([value, label]) =>
        [value, mode === 'airline_info' ? value.toUpperCase() + ' 항공사 코드' : label]);
    }
    if (name === 'ident') spec.placeholder = forms[mode].example;
    if (name === 'start' && mode === 'live') spec.label = 'OpenSky 스냅샷 시각 (UTC)';
    if (name === 'airport' && ['airport_info', 'airport_runways'].includes(mode)) spec.required = true;
    if (name === 'ident' && mode === 'history') spec.required = false;
    if (name === 'ident' && mode === 'schedule') Object.assign(spec, { label: '편명', placeholder: 'KE123', required: false });
    if (mode === 'route' && (name === 'airport' || name === 'oppositeAirport')) {
      spec.label = name === 'airport' ? '출발 공항 코드' : '도착 공항 코드';
      spec.required = true;
    }
    return createField(name, spec, 'field-');
  }

  function fr24Field(endpoint, name) {
    const schema = config.fr24ParamProperties[name] ?? {};
    const spec = {
      ...schema,
      label: name,
      type: schema.type === 'integer' ? 'number' : 'text',
      options: schema.enum?.map((value) => [value, value]),
      ...fr24Specs[name],
      required: endpoint.required_parameters.includes(name),
    };
    return createField(name, spec, 'fr24-');
  }

  const selectedNativeProvider = () => nativeProviders.find(({ id }) => id === nativeProvider.value);
  const selectedNativeEndpoint = () => selectedNativeProvider()?.endpoints.find(({ id }) => id === nativeEndpoint.value);

  function showOptional(items) {
    additionalFields.replaceChildren(...items);
    additional.hidden = items.length === 0;
  }

  function showFr24Fields(endpoint) {
    const primary = endpoint.parameters.filter((name) => fr24Primary.has(name) || endpoint.required_parameters.includes(name));
    const secondary = endpoint.parameters.filter((name) => !primary.includes(name));
    nativeFields.replaceChildren(...primary.map((name) => fr24Field(endpoint, name)));
    showOptional(secondary.map((name) => fr24Field(endpoint, name)));
  }

  function schemaField(name, schema, required, prefix) {
    const type = Array.isArray(schema.type) ? schema.type.find((type) => type !== 'null') : schema.type;
    const values = schema.values ?? schema.enum;
    let options = values?.map((value) => [String(value), String(value)]);
    if (type === 'boolean') options = [['true', '예 (true)'], ['false', '아니요 (false)']];
    if (options) options.unshift(['', required ? '선택하세요' : '공급자 기본값']);
    const isNumber = type === 'integer' || type === 'number';
    const jsonType = type === 'array' || type === 'object' ? type : undefined;
    const formatCaption = schema.format === 'date-time'
      ? (schema.pattern ? 'YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm' : 'YYYY-MM-DDTHH:mm:ssZ')
      : undefined;
    const jsonCaption = { array: 'JSON 배열을 입력하세요.', object: 'JSON 객체를 입력하세요.' }[jsonType];
    return createField(name, {
      ...schema, required, options,
      label: schema.label ?? name,
      type: isNumber ? 'number' : ({ date: 'date', uri: 'url' }[schema.format] ?? 'text'),
      step: type === 'number' ? 'any' : undefined,
      valueType: jsonType ?? (options && isNumber ? 'number' : type === 'boolean' ? 'boolean' : undefined),
      placeholder: schema.placeholder ?? formatCaption,
      help: [schema.description, jsonCaption].filter(Boolean).join(' '),
    }, prefix);
  }

  function showAeroFields(endpoint) {
    const { required: requiredParams, params, body } = endpoint;
    const field = (name) => schemaField(name, {
      ...config.aerodatabox.parameters?.[name], ...endpoint.parameters?.[name],
    }, requiredParams.includes(name), 'aerodatabox-');
    nativeFields.replaceChildren(...params.filter((name) => requiredParams.includes(name)).map(field));
    aerodataBoxBodyFields.replaceChildren(...Object.entries(body?.properties ?? {}).map(([name, schema]) =>
      schemaField(name, schema, body.required?.includes(name), 'aerodatabox-body-')));
    const optional = params.filter((name) => !requiredParams.includes(name)).map(field);
    optional.push(createField('format', fieldSpecs.format, 'aerodatabox-'));
    showOptional(optional);
  }

  function showNativeEndpoints(keepEndpoint = false) {
    setEndpointOptions(selectedNativeProvider()?.endpoints ?? [], keepEndpoint ? nativeEndpoint.value : '');
    showNativeFields();
  }

  function resetNativeFields() {
    nativeFields.replaceChildren();
    nativeFormat.replaceChildren();
    aerodataBoxBodyFields.replaceChildren();
    nativeBodyArea.hidden = true;
    nativeBody.disabled = true;
    nativeConfirm.checked = false;
    nativeConfirmation.hidden = true;
  }

  function endpointNote(provider, endpoint) {
    if (!endpoint) return '';
    if (provider.id === 'flightradar24' && config.fr24_plan) return '플랜 ' + config.fr24_plan;
    if (provider.id === 'aerodatabox') {
      if (endpoint.base_units === null) return 'Tier ' + endpoint.tier + ' · 요청한 크레딧 수만큼 API 단위 사용';
      return endpoint.tier === 'free' ? '무료 그룹' : 'Tier ' + endpoint.tier;
    }
    return endpoint.note ?? '';
  }

  function showNativeFields() {
    resetNativeFields();
    const provider = selectedNativeProvider();
    const endpoint = selectedNativeEndpoint();
    const method = endpoint?.method ?? 'GET';
    const isWrite = endpoint?.changes_account ?? (method !== 'GET');
    nativePath.hidden = !endpoint;
    nativeMethod.textContent = method;
    nativeMethod.className = method === 'GET' ? 'get' : 'post';
    nativePathValue.textContent = endpoint?.path ?? '';
    nativeNote.textContent = endpointNote(provider, endpoint);
    nativeDocs.hidden = !provider?.docs?.startsWith('https://');
    if (!nativeDocs.hidden) nativeDocs.href = provider.docs;
    nativeConfirmation.hidden = !isWrite;
    if (!endpoint) return showOptional([]);
    if (provider.id === 'flightradar24') return showFr24Fields(endpoint);
    if (provider.id === 'aerodatabox') return showAeroFields(endpoint);

    const required = [];
    const optional = [];
    for (const parameter of endpoint?.parameters ?? []) {
      const mandatory = parameter.required || parameter.in === 'path';
      const schema = { ...parameter.schema, description: parameter.description ?? parameter.schema?.description };
      const control = schemaField(parameter.name, schema, mandatory, 'native-param-');
      (mandatory ? required : optional).push(control);
    }
    nativeFields.replaceChildren(...required);
    showOptional(optional);

    const formats = endpoint?.formats ?? [];
    if (formats.length > 1) {
      nativeFormat.append(createField('format', {
        ...fieldSpecs.format, options: [['', '공급자 기본값'], ...formats.map((format) => [format, format.toUpperCase()])],
      }, 'native-response-'));
    }
    const body = endpoint?.body;
    nativeBodyArea.hidden = !body;
    nativeBody.disabled = !body;
    nativeBody.required = Boolean(body && (endpoint.bodyRequired || body.required?.length));
    nativeBodyLabel.textContent = '요청 본문 (JSON)' + (nativeBody.required ? ' *' : '');
    nativeBody.value = '';
    nativeBodySchema.textContent = body ? JSON.stringify(body, null, 2) : '';
  }

  function updateActions() {
    const endpoint = selectedNativeEndpoint();
    const noNativeRequest = operation.value === 'native' && (!endpoint || endpoint.available_on_plan === false ||
      (!nativeConfirmation.hidden && !nativeConfirm.checked));
    submit.disabled = Boolean(active) || noNativeRequest;
    cancel.disabled = !active;
  }

  function showOperation() {
    const mode = operation.value;
    native.hidden = mode !== 'native';
    providerFieldset.hidden = mode === 'native';
    fields.replaceChildren();
    additional.open = false;
    if (mode === 'native') {
      showNativeEndpoints(true);
    } else {
      resetNativeFields();
      const current = forms[mode];
      fields.append(...current.fields.map((name) => genericField(mode, name)));
      showOptional(current.optional.map((name) => genericField(mode, name)));
    }
    updateActions();
    updatePreview();
  }

  function jsonValue(text, label, type) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(label + '에 올바른 JSON을 입력하세요.');
    }
    if (type === 'array' && !Array.isArray(value)) throw new Error(label + '에 JSON 배열을 입력하세요.');
    if (type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(label + '에 JSON 객체를 입력하세요.');
    }
    return value;
  }

  function fieldValues(container) {
    const values = {};
    for (const field of container.querySelectorAll('input, select')) {
      let value = field.value.trim();
      if (!value) continue;
      if (field.type === 'number' || field.dataset.valueType === 'number') value = Number(value);
      if (field.dataset.valueType === 'boolean') value = value === 'true';
      if (field.dataset.valueType === 'array' || field.dataset.valueType === 'object') {
        value = jsonValue(value, field.name, field.dataset.valueType);
      }
      if (field.type === 'datetime-local') {
        value += value.length === 16 ? ':00Z' : 'Z';
        if (field.dataset.valueType === 'timestamp') value = Math.floor(Date.parse(value) / 1000);
      }
      values[field.name] = value;
    }
    return values;
  }

  function readEndpointRequest() {
    const provider = selectedNativeProvider();
    const endpoint = selectedNativeEndpoint();
    if (!endpoint) throw new Error('공급자와 엔드포인트를 선택하세요.');
    const params = { ...fieldValues(nativeFields), ...fieldValues(additionalFields) };
    const confirmed = !nativeConfirmation.hidden && nativeConfirm.checked;
    if (provider.id === 'flightradar24') {
      return { operation: 'fr24', fr24Endpoint: endpoint.id, fr24Params: params };
    }
    if (provider.id === 'aerodatabox') {
      const { format, ...aerodataBoxParams } = params;
      const input = {
        operation: 'aerodatabox',
        aerodataBoxEndpoint: endpoint.id,
        aerodataBoxParams,
      };
      if (endpoint.body) input.aerodataBoxBody = fieldValues(aerodataBoxBodyFields);
      if (confirmed) input.confirmAeroDataBoxChange = true;
      if (format) input.format = format;
      return input;
    }
    const input = { operation: 'native', nativeProvider: provider.id, nativeEndpoint: endpoint.id };
    if (Object.keys(params).length) input.nativeParams = params;
    const body = nativeBody.value?.trim();
    if (!nativeBody.disabled && body) input.nativeBody = jsonValue(body, '요청 본문');
    const { format } = fieldValues(nativeFormat);
    if (format) input.format = format;
    if (confirmed) input.confirmNativeChange = true;
    return input;
  }

  function readRequest() {
    const mode = operation.value;
    if (mode === 'native') return readEndpointRequest();
    const input = { operation: mode === 'route' ? 'airport' : mode, ...fieldValues(fields), ...fieldValues(additionalFields) };
    if (mode === 'history' && !input.ident) delete input.identType;
    if (mode === 'route') input.direction = 'departure';
    for (const field of providerFields) {
      const values = field.value.split(',').map((id) => id.trim()).filter(Boolean);
      if (values.length) input[field.name] = values;
    }
    return input;
  }

  function updatePreview() {
    try {
      requestPreview.textContent = JSON.stringify(readRequest(), null, 2);
    } catch (error) {
      requestPreview.textContent = error.message;
    }
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
  nativeProvider.addEventListener('change', () => {
    additional.open = false;
    showNativeEndpoints();
    updateActions();
    updatePreview();
  });
  nativeEndpoint.addEventListener('change', () => {
    additional.open = false;
    showNativeFields();
    updateActions();
    updatePreview();
  });
  nativeConfirm.addEventListener('change', () => {
    updateActions();
    updatePreview();
  });
  form.addEventListener('input', updatePreview);
  cancel.addEventListener('click', () => active?.abort());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (active || submit.disabled) return;
    results.replaceChildren();
    received = 0;
    let input;
    try {
      input = readRequest();
    } catch (error) {
      status.textContent = error.message;
      status.setAttribute('data-error', '');
      return;
    }
    if (input.confirmAeroDataBoxChange || input.confirmNativeChange) {
      nativeConfirm.checked = false;
      updatePreview();
    }
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

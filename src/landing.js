export const landing = `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aviation Raw Tracker</title>
<style>
  body { margin: 0; background: #f5f7fb; color: #172746; font: 1rem/1.6 system-ui, sans-serif; }
  main { max-width: 48rem; margin: clamp(2rem, 9vh, 6rem) auto; padding: 0 1.25rem; }
  h1 { margin: 0; font-size: clamp(2rem, 7vw, 3.2rem); letter-spacing: -.04em; line-height: 1.15; }
  label { display: block; margin-bottom: .35rem; font-weight: 600; }
  textarea { box-sizing: border-box; width: 100%; min-height: 10rem; border: 1px solid #8494ad; border-radius: .5rem; padding: .75rem; background: #fff; color: inherit; font: 1rem/1.5 monospace; }
  button { padding: .5rem .9rem; border: 1px solid #174383; border-radius: .4rem; background: #174383; color: white; font: inherit; }
  button:disabled { opacity: .55; }
  button + button { margin-left: .5rem; background: white; color: #174383; }
  details { margin: .55rem 0; padding: .5rem .8rem; border: 1px solid #bdc9da; border-radius: .5rem; background: white; }
  summary { cursor: pointer; font-weight: 600; }
  pre { overflow: auto; max-height: 28rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  code { padding: .1em .25em; background: #e1e9f6; border-radius: .2em; }
</style>
<main>
  <h1>Aviation Raw Tracker</h1>
  <p>한 번의 요청으로 대상 공급자를 동시에 조회합니다. 원본 응답은 도착하는 순서대로 표시됩니다. Dots에서 자료를 종합하려면 <code>aviation_lookup</code>을 사용하세요.</p>
  <form id="lookup">
    <label for="query">조회 조건 (JSON)</label>
    <textarea id="query" required spellcheck="false">{
  "operation": "live",
  "identType": "callsign",
  "ident": "KAL93"
}</textarea>
    <div><button id="submit">조회</button><button type="button" id="cancel" disabled>중단</button></div>
  </form>
  <p id="status" role="status" aria-live="polite"></p>
  <section id="results" aria-label="공급자 원본 응답"></section>
</main>
<script type="module">
  const form = document.querySelector('#lookup');
  const results = document.querySelector('#results');
  const status = document.querySelector('#status');
  const submit = document.querySelector('#submit');
  const cancel = document.querySelector('#cancel');
  let active;

  function addResult(label, value) {
    const panel = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = label;
    const body = document.createElement('pre');
    body.textContent = value;
    panel.append(heading, body);
    results.append(panel);
  }

  function render(record) {
    if (record.type === 'error') throw new Error(record.message);
    if (record.type === 'provider') {
      const source = record.source;
      const code = source.http_status ? ' · HTTP ' + source.http_status : '';
      addResult(source.label + ' · ' + source.status + code, record.raw_body ?? JSON.stringify(source, null, 2));
      status.textContent = results.childElementCount + '개 공급자 응답 수신';
      return;
    }
    if (record.type === 'complete') {
      status.textContent = results.childElementCount + '개 공급자 응답 수신. 조회 완료.';
      addResult('조회 상태와 권장 시각', JSON.stringify(record.structuredContent, null, 2));
    }
  }

  cancel.addEventListener('click', () => active?.abort());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#query').value;
    try { JSON.parse(input); } catch { status.textContent = '조회 조건을 올바른 JSON으로 입력하세요.'; return; }
    results.replaceChildren();
    status.textContent = '조회 중…';
    active = new AbortController();
    submit.disabled = true;
    cancel.disabled = false;
    try {
      const response = await fetch('/lookup/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: input, signal: active.signal,
      });
      if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        throw new Error('조회 스트림을 열 수 없습니다. HTTP ' + response.status);
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
          for (const line of lines) if (line) render(JSON.parse(line));
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    } catch (error) {
      status.textContent = active.signal.aborted ? '조회를 중단했습니다.' : error.message;
    } finally {
      active = null;
      submit.disabled = false;
      cancel.disabled = true;
    }
  });
</script>
</html>`;

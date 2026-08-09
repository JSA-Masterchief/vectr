/**
 * diagnostics.js
 * ------------------------------------------------------------
 * A self-contained connection test, deliberately bypassing
 * opensky.js/adsblol.js's own caching and fallback logic, so it
 * shows the true, current reachability of each path from this
 * exact browser — the same information you'd otherwise have to
 * dig for in DevTools' Network/Console tabs.
 *
 * Tests, in order:
 *   1. OpenSky direct
 *   2. OpenSky via the CORS proxy
 *   3. adsb.lol direct
 *   4. adsb.lol via the CORS proxy
 * Each reports: pass/fail, latency, and the precise failure
 * reason (HTTP status, or the browser's own error name/message
 * for network/CORS failures).
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const link = document.getElementById('diagnosticsLink');
  const modal = document.getElementById('diagnosticsModal');
  const closeBtn = document.getElementById('diagnosticsCloseBtn');
  const runBtn = document.getElementById('diagnosticsRunBtn');
  const resultsEl = document.getElementById('diagnosticsResults');

  const CORS_PROXY = 'https://api.codetabs.com/v1/proxy/?quest=';
  const TIMEOUT_MS = 10000;

  function openModal() {
    modal.hidden = false;
    modal.style.display = 'flex';
    if (!resultsEl.children.length) runTests();
  }
  function closeModal() {
    modal.hidden = true;
    modal.style.display = 'none';
  }
  link.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  runBtn.addEventListener('click', runTests);

  async function timedFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = performance.now();
    try {
      const res = await fetch(url, { signal: controller.signal });
      const ms = Math.round(performance.now() - start);
      if (!res.ok) return { ok: false, ms, detail: `HTTP ${res.status}` };
      // Confirm the body actually parses as JSON, not just that the
      // request "succeeded" - a proxy can return HTTP 200 with an
      // error page body, which would otherwise look like a pass.
      await res.json();
      return { ok: true, ms, detail: `HTTP ${res.status}` };
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      const detail = err.name === 'AbortError' ? `Timed out after ${TIMEOUT_MS / 1000}s` : `${err.name}: ${err.message}`;
      return { ok: false, ms, detail };
    } finally {
      clearTimeout(timer);
    }
  }

  const TESTS = [
    { label: 'OpenSky — direct', url: 'https://opensky-network.org/api/states/all?lamin=51&lamax=52&lomin=0&lomax=1' },
    {
      label: 'OpenSky — via CORS proxy',
      url: CORS_PROXY + encodeURIComponent('https://opensky-network.org/api/states/all?lamin=51&lamax=52&lomin=0&lomax=1'),
    },
    { label: 'adsb.lol — direct', url: 'https://api.adsb.lol/v2/callsign/VECTR' },
    { label: 'adsb.lol — via CORS proxy', url: CORS_PROXY + encodeURIComponent('https://api.adsb.lol/v2/callsign/VECTR') },
  ];

  function renderRow(label) {
    const row = document.createElement('div');
    row.className = 'diag-row';
    row.innerHTML = `
      <span class="diag-icon">⏳</span>
      <span class="diag-label">${label}</span>
      <span class="diag-detail">Testing…</span>
    `;
    return row;
  }

  function updateRow(row, result) {
    row.querySelector('.diag-icon').textContent = result.ok ? '✅' : '❌';
    row.querySelector('.diag-icon').className = `diag-icon ${result.ok ? 'good' : 'bad'}`;
    row.querySelector('.diag-detail').textContent = `${result.detail} · ${result.ms}ms`;
  }

  async function runTests() {
    resultsEl.innerHTML = '';
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';

    const rows = TESTS.map((t) => {
      const row = renderRow(t.label);
      resultsEl.appendChild(row);
      return row;
    });

    await Promise.all(
      TESTS.map(async (t, i) => {
        const result = await timedFetch(t.url);
        updateRow(rows[i], result);
      })
    );

    runBtn.disabled = false;
    runBtn.textContent = 'Run test again';
  }
})();

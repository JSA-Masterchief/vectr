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
  const summaryEl = document.getElementById('diagnosticsSummary');

  const CORS_PROXIES = [
    { name: 'codetabs', build: (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}` },
    { name: 'corsproxy.io', build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
    { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  ];
  const TIMEOUT_MS = 10000;
  // A well-known, always-up, definitely-CORS-enabled API, used as a
  // control: if THIS also fails, the problem isn't OpenSky/adsb.lol
  // specifically — it's something blocking cross-origin requests
  // from this browser/network entirely (a privacy extension,
  // corporate firewall, DNS filtering, etc.), which no change to
  // Vectr's code can fix.
  const CONTROL_URL = 'https://api.github.com';

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
    { label: 'Control — api.github.com (known-good)', url: CONTROL_URL },
    { label: 'OpenSky — direct', url: 'https://opensky-network.org/api/states/all?lamin=51&lamax=52&lomin=0&lomax=1' },
    { label: 'adsb.lol — direct', url: 'https://api.adsb.lol/v2/callsign/VECTR' },
    ...CORS_PROXIES.map((p) => ({ label: `Proxy — ${p.name}`, url: p.build(CONTROL_URL) })),
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
    summaryEl.textContent = '';
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';

    const rows = TESTS.map((t) => {
      const row = renderRow(t.label);
      resultsEl.appendChild(row);
      return row;
    });

    const results = await Promise.all(
      TESTS.map(async (t, i) => {
        const result = await timedFetch(t.url);
        updateRow(rows[i], result);
        return { label: t.label, ...result };
      })
    );

    renderSummary(results);
    runBtn.disabled = false;
    runBtn.textContent = 'Run test again';
  }

  function renderSummary(results) {
    const control = results[0];
    const openSky = results[1];
    const adsbLol = results[2];
    const proxies = results.slice(3);
    const anyProxyOk = proxies.some((p) => p.ok);

    if (!control.ok) {
      summaryEl.textContent =
        '⚠️ Even the control test (a well-known, always-up API) failed. This points to something blocking cross-origin requests on this specific browser or network — a privacy extension, corporate/school firewall, or DNS filtering — rather than a Vectr or provider problem. Try a different network, a different browser, or temporarily disabling extensions (ad blockers/privacy tools) to confirm.';
    } else if (!openSky.ok && !adsbLol.ok && !anyProxyOk) {
      summaryEl.textContent =
        '⚠️ The control test passed, but OpenSky, adsb.lol, AND every proxy failed. These specific services may be down or blocked on this network right now — worth trying again later or from a different network.';
    } else if (!openSky.ok && !adsbLol.ok && anyProxyOk) {
      summaryEl.textContent =
        '✅ At least one proxy works, which Vectr will use automatically. OpenSky and adsb.lol direct connections are currently blocked here (likely CORS or network-level), but live data should still load via the working proxy.';
    } else {
      summaryEl.textContent = '✅ At least one live-data path is working directly — Vectr should be showing live data.';
    }
  }
})();

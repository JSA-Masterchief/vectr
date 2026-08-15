/**
 * diagnostics.js
 * ------------------------------------------------------------
 * Connection diagnostics, now a full page view (Day 20) instead
 * of a modal — the modal ran out of room and things overlapped
 * once the module-check section was added. Same tests as before:
 *
 *   1. Module integrity check — runs immediately on page load,
 *      before any network request, so a missing/misplaced file
 *      doesn't get misdiagnosed as a network problem.
 *   2. A control test (a well-known, always-up API) to tell
 *      "these specific providers are broken" apart from "this
 *      browser/network blocks cross-origin requests generally."
 *   3. OpenSky and adsb.lol direct.
 *   4. Each CORS proxy individually.
 *   5. Manual direct-open links (bypass fetch()/CORS entirely).
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const navBtn = document.getElementById('navDiagnostics');
  const backBtn = document.getElementById('diagnosticsBackBtn');
  const runBtn = document.getElementById('diagnosticsRunBtn');
  const resultsEl = document.getElementById('diagnosticsResults');
  const summaryEl = document.getElementById('diagnosticsSummary');
  const moduleResultsEl = document.getElementById('moduleCheckResults');
  const banner = document.getElementById('moduleErrorBanner');
  const bannerText = document.getElementById('moduleErrorText');
  const bannerDetailsBtn = document.getElementById('moduleErrorDetailsBtn');

  navBtn.addEventListener('click', () => {
    Views.show('diagnostics');
    if (!resultsEl.children.length) runTests();
  });
  bannerDetailsBtn.addEventListener('click', () => Views.show('diagnostics'));
  if (backBtn) {
    backBtn.addEventListener('click', () => Views.show('home'));
  }

  // ---------- Module integrity check ----------
  const REQUIRED_MODULES = [
    { name: 'Views', check: () => typeof Views !== 'undefined' && typeof Views.show === 'function', file: 'js/views.js' },
    { name: 'Favorites', check: () => typeof Favorites !== 'undefined' && typeof Favorites.getFlights === 'function', file: 'js/favorites.js' },
    { name: 'Airports', check: () => typeof Airports !== 'undefined' && typeof Airports.search === 'function', file: 'js/airports.js' },
    { name: 'Airlines', check: () => typeof Airlines !== 'undefined' && typeof Airlines.expandQuery === 'function', file: 'js/airlines.js' },
    { name: 'AdsbLol', check: () => typeof AdsbLol !== 'undefined' && typeof AdsbLol.findByCallsign === 'function', file: 'js/adsblol.js' },
    { name: 'OpenSky', check: () => typeof OpenSky !== 'undefined' && typeof OpenSky.findByFlightNumber === 'function', file: 'js/opensky.js' },
    { name: 'AeroDataBox', check: () => typeof AeroDataBox !== 'undefined' && typeof AeroDataBox.getSchedule === 'function', file: 'js/aerodatabox.js' },
  ];

  function diagRow(name, ok, detail) {
    const row = document.createElement('div');
    row.className = 'diag-row';
    row.innerHTML = `
      <span class="diag-icon ${ok ? 'good' : 'bad'}">${ok ? '\u2705' : '\u274c'}</span>
      <span class="diag-label">${name}</span>
      <span class="diag-detail">${detail}</span>
    `;
    return row;
  }

  function runModuleCheck() {
    const results = REQUIRED_MODULES.map((m) => {
      let ok = false;
      try {
        ok = m.check();
      } catch {
        ok = false;
      }
      return { ...m, ok };
    });

    if (moduleResultsEl) {
      moduleResultsEl.innerHTML = '';
      results.forEach((r) => {
        moduleResultsEl.appendChild(diagRow(r.name, r.ok, r.ok ? 'Loaded' : `Missing \u2014 check ${r.file}`));
      });
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      const fileList = failed.map((f) => f.file).join(', ');
      bannerText.textContent = `\u26a0\ufe0f Vectr didn't load correctly \u2014 missing or broken: ${failed.map((f) => f.name).join(', ')}. Check that ${fileList} ${failed.length > 1 ? 'are' : 'is'} present and in the right place in your repo.`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
    return failed;
  }

  runModuleCheck();

  // ---------- Network tests ----------
  const CORS_PROXIES = [
    { name: 'codetabs', build: (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}` },
    { name: 'corsproxy.io', build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
    { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  ];
  const TIMEOUT_MS = 10000;
  const CONTROL_URL = 'https://api.github.com';

  async function timedFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = performance.now();
    try {
      const res = await fetch(url, { signal: controller.signal });
      const ms = Math.round(performance.now() - start);
      if (!res.ok) return { ok: false, ms, detail: `HTTP ${res.status}` };
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
    { label: 'Control \u2014 api.github.com (known-good)', url: CONTROL_URL },
    { label: 'OpenSky \u2014 direct', url: 'https://opensky-network.org/api/states/all?lamin=51&lamax=52&lomin=0&lomax=1' },
    { label: 'adsb.lol \u2014 direct', url: 'https://api.adsb.lol/v2/callsign/VECTR' },
    ...CORS_PROXIES.map((p) => ({ label: `Proxy \u2014 ${p.name}`, url: p.build(CONTROL_URL) })),
  ];

  async function runTests() {
    resultsEl.innerHTML = '';
    summaryEl.textContent = '';
    runBtn.disabled = true;
    runBtn.textContent = 'Running\u2026';

    const rows = TESTS.map((t) => {
      const row = diagRow(t.label, true, 'Testing\u2026');
      row.querySelector('.diag-icon').textContent = '\u23f3';
      row.querySelector('.diag-icon').className = 'diag-icon';
      resultsEl.appendChild(row);
      return row;
    });

    const results = await Promise.all(
      TESTS.map(async (t, i) => {
        const result = await timedFetch(t.url);
        rows[i].querySelector('.diag-icon').textContent = result.ok ? '\u2705' : '\u274c';
        rows[i].querySelector('.diag-icon').className = `diag-icon ${result.ok ? 'good' : 'bad'}`;
        rows[i].querySelector('.diag-detail').textContent = `${result.detail} \u00b7 ${result.ms}ms`;
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
        '\u26a0\ufe0f Even the control test (a well-known, always-up API) failed. This points to something blocking cross-origin requests on this specific browser or network \u2014 a privacy extension, corporate/school firewall, or DNS filtering \u2014 rather than a Vectr or provider problem. Try a different network, a different browser, or temporarily disabling extensions to confirm.';
    } else if (!openSky.ok && !adsbLol.ok && !anyProxyOk) {
      summaryEl.textContent =
        '\u26a0\ufe0f The control test passed, but OpenSky, adsb.lol, AND every proxy failed. These specific services may be down or blocked on this network right now \u2014 worth trying again later or from a different network.';
    } else if (!openSky.ok && !adsbLol.ok && anyProxyOk) {
      summaryEl.textContent =
        '\u2705 At least one proxy works, which Vectr will use automatically (racing all of them in parallel, so a slow/dead one never holds up a working one). OpenSky and adsb.lol direct connections are currently blocked here, but live data should load via the working proxy.';
    } else {
      summaryEl.textContent = '\u2705 At least one live-data path is working directly \u2014 Vectr should be showing live data.';
    }
  }

  runBtn.addEventListener('click', runTests);
})();

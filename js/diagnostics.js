/**
 * diagnostics.js
 * ------------------------------------------------------------
 * Connection diagnostics page. Module integrity check runs
 * immediately on load; network tests run one at a time (not
 * Promise.all - see Day 26) when triggered.
 *
 * DAY 35: corsproxy.io removed from the tested proxy list -
 * confirmed they now require an API key for reliable access, so
 * testing the old unauthenticated form just produces a guaranteed,
 * uninformative 401.
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
  if (backBtn) backBtn.addEventListener('click', () => Views.show('home'));

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
  // corsproxy.io removed (Day 35): now requires an API key for
  // reliable access - the plain unauthenticated form returns an
  // instant HTTP 401, which isn't useful diagnostic information.
  const CORS_PROXIES = [
    { name: 'thingproxy', build: (url) => `https://thingproxy.freeboard.io/fetch/${url}` },
    { name: 'allorigins', build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  ];
  const TIMEOUT_MS = 10000;
  const CONTROL_URL = 'https://api.github.com';
  const REAL_OPENSKY_URL = 'https://opensky-network.org/api/states/all?lamin=51&lamax=52&lomin=0&lomax=1';
  const REAL_ADSBLOL_URL = 'https://api.adsb.lol/v2/callsign/VECTR';

  function withBust(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
  }

  async function timedFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const start = performance.now();
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
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

  function buildTests() {
    const customProxyTests =
      typeof CustomProxy !== 'undefined' && CustomProxy.has()
        ? [
            { label: 'Your private proxy (OpenSky query)', url: withBust(CustomProxy.build(REAL_OPENSKY_URL)) },
            { label: 'Your private proxy (adsb.lol query)', url: withBust(CustomProxy.build(REAL_ADSBLOL_URL)) },
          ]
        : [];

    return {
      customCount: customProxyTests.length,
      tests: [
        { label: 'Control \u2014 api.github.com (known-good)', url: CONTROL_URL },
        { label: 'OpenSky \u2014 direct', url: REAL_OPENSKY_URL },
        { label: 'adsb.lol \u2014 direct', url: REAL_ADSBLOL_URL },
        ...customProxyTests,
        ...CORS_PROXIES.map((p) => ({ label: `Proxy \u2014 ${p.name} (OpenSky query)`, url: withBust(p.build(REAL_OPENSKY_URL)) })),
        ...CORS_PROXIES.map((p) => ({ label: `Proxy \u2014 ${p.name} (adsb.lol query)`, url: withBust(p.build(REAL_ADSBLOL_URL)) })),
      ],
    };
  }

  async function runTests() {
    resultsEl.innerHTML = '';
    summaryEl.textContent = '';
    runBtn.disabled = true;

    const { tests: TESTS, customCount } = buildTests();

    const rows = TESTS.map((t) => {
      const row = diagRow(t.label, true, 'Waiting\u2026');
      row.querySelector('.diag-icon').textContent = '\u23f3';
      row.querySelector('.diag-icon').className = 'diag-icon';
      resultsEl.appendChild(row);
      return row;
    });

    const results = [];
    for (let i = 0; i < TESTS.length; i++) {
      runBtn.textContent = `Running\u2026 (${i + 1}/${TESTS.length})`;
      rows[i].querySelector('.diag-detail').textContent = 'Testing\u2026';
      const result = await timedFetch(TESTS[i].url);
      rows[i].querySelector('.diag-icon').textContent = result.ok ? '\u2705' : '\u274c';
      rows[i].querySelector('.diag-icon').className = `diag-icon ${result.ok ? 'good' : 'bad'}`;
      rows[i].querySelector('.diag-detail').textContent = `${result.detail} \u00b7 ${result.ms}ms`;
      results.push({ label: TESTS[i].label, ...result });
    }

    renderSummary(results, customCount);
    runBtn.disabled = false;
    runBtn.textContent = 'Run test again';
  }

  function renderSummary(results, customCount) {
    const control = results[0];
    const openSky = results[1];
    const adsbLol = results[2];
    const customTests = results.slice(3, 3 + customCount);
    const publicProxyTests = results.slice(3 + customCount);
    const anyCustomOk = customTests.some((p) => p.ok);
    const anyPublicOk = publicProxyTests.some((p) => p.ok);
    const anyProxyOk = anyCustomOk || anyPublicOk;

    const setupSuggestion = customCount
      ? ''
      : ' Consider setting up your own private proxy (footer link below) \u2014 public proxies are shared by everyone using them and rate-limit hard, and some now require paid API keys entirely.';

    if (!control.ok) {
      summaryEl.textContent =
        '\u26a0\ufe0f Even the control test (a well-known, always-up API) failed. This points to something blocking cross-origin requests on this specific browser or network \u2014 a privacy extension, corporate/school firewall, or DNS filtering \u2014 rather than a Vectr or provider problem.';
    } else if (!openSky.ok && !adsbLol.ok && !anyProxyOk) {
      summaryEl.textContent = `\u26a0\ufe0f The control test passed, but OpenSky, adsb.lol, AND every proxy \u2014 tested against the real query URLs \u2014 failed.${setupSuggestion}`;
    } else if (!openSky.ok && !adsbLol.ok && anyProxyOk) {
      const allWorking = [...customTests.filter((p) => p.ok), ...publicProxyTests.filter((p) => p.ok)];
      const workingNames = [...new Set(allWorking.map((p) => p.label.replace(/ \(.*\)$/, '')))];
      const viaCustom = anyCustomOk ? ' (including your private proxy \u2014 the most reliable option)' : '';
      summaryEl.textContent = `\u2705 Confirmed working: ${workingNames.join(', ')}${viaCustom}. Vectr will use this automatically.`;
    } else {
      summaryEl.textContent = '\u2705 At least one live-data path is working directly \u2014 Vectr should be showing live data.';
    }
  }

  runBtn.addEventListener('click', runTests);
})();

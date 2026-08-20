/**
 * opensky.js
 * ------------------------------------------------------------
 * Thin wrapper around The OpenSky Network's public REST API,
 * with automatic fallback to adsb.lol (see adsblol.js), and a
 * further fallback that races several public CORS proxies in
 * parallel if a request fails with what looks like a browser-level
 * network/CORS error rather than a clean HTTP error from the
 * server itself.
 *
 * DAY 20 FIX — the actual bug behind "diagnostics says it should
 * work, but nothing loads": findByFlightNumber() and getByIcao24()
 * used to call OpenSky's /states/all with NO bounding box at all —
 * fetching every aircraft on Earth (a multi-megabyte response) just
 * to filter it down to one callsign or one hex client-side. That's
 * wasteful even directly, and free CORS proxies choke on payloads
 * that size even when they handle small test pings fine — which is
 * exactly why the diagnostics panel's lightweight test could pass
 * while the real search kept failing/hanging.
 *
 * Fixed by flipping the order for these two lookups specifically:
 * adsb.lol's targeted callsign/hex endpoints (small, fast, exactly
 * what's needed) are now tried FIRST, with OpenSky's full global
 * list only used as a last-resort fallback. fetchStatesInBbox()
 * (Airport Explorer / Live Map) was never affected by this — it
 * already scopes every query to a bounding box.
 *
 * The public function names/signatures here
 * (`findByFlightNumber`, `getByIcao24`, `fetchStatesInBbox`) are
 * what app.js / airportview.js / livemap.js call — kept stable on
 * purpose so swapping/adding providers never requires touching
 * those files.
 * ------------------------------------------------------------
 */
const OpenSky = (() => {
  const STATES_URL = 'https://opensky-network.org/api/states/all';
  const CACHE_MS = 9000; // don't hammer the API faster than this
  // Several free, keyless CORS proxies, raced in parallel as a last
  // resort when a direct fetch fails with what looks like a
  // browser-level network/CORS error. Racing (not trying one at a
  // time) means a single slow/dead proxy never delays a request
  // past however long the fastest working one takes.
  // Ordered by demonstrated reliability across multiple real test
  // runs: corsproxy.io has been the most consistently reachable;
  // codetabs has timed out on every single test run so far, so it's
  // tried last (when it fails, it wastes the most time of any of
  // these, so it shouldn't be first in a sequential chain).
  const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  ];
  const REQUEST_TIMEOUT_MS = 10000;

  // OpenSky state vector column order, per their API docs.
  const COLS = [
    'icao24', 'callsign', 'origin_country', 'time_position', 'last_contact',
    'longitude', 'latitude', 'baro_altitude', 'on_ground', 'velocity',
    'true_track', 'vertical_rate', 'sensors', 'geo_altitude', 'squawk',
    'spi', 'position_source', 'category'
  ];

  function rowToFlight(row) {
    const f = {};
    COLS.forEach((c, i) => (f[c] = row[i]));
    f.callsign = (f.callsign || '').trim();
    return f;
  }

  /** Carries BOTH providers' failure reasons, instead of hiding one. */
  class DualFailureError extends Error {
    constructor(openSkyReason, adsbLolReason) {
      super(`OpenSky: ${openSkyReason} \u00b7 adsb.lol: ${adsbLolReason}`);
      this.name = 'DualFailureError';
      this.openSkyReason = openSkyReason;
      this.adsbLolReason = adsbLolReason;
      this.isRateLimit = openSkyReason === 'RATE_LIMIT' && adsbLolReason === 'RATE_LIMIT';
    }
  }

  function describeError(err) {
    if (err.message === 'RATE_LIMIT') return 'RATE_LIMIT';
    if (err.message === 'TIMEOUT') return 'TIMEOUT';
    // A broken/missing dependency (e.g. adsblol.js didn't load, or
    // loaded after opensky.js) throws a TypeError that looks
    // identical to a real network failure otherwise — check for it
    // by name so a deployment problem doesn't get misdiagnosed as a
    // network/CORS issue.
    if (typeof AdsbLol === 'undefined') return 'ADSBLOL_MODULE_MISSING';
    // A fetch() TypeError ("Failed to fetch", "NetworkError...") is
    // the classic browser-side symptom of a CORS block or genuine
    // connectivity failure — worth distinguishing from a clean HTTP
    // error status the server actually sent back.
    if (err.name === 'TypeError') return 'NETWORK_OR_CORS';
    return err.message || 'UNKNOWN_ERROR';
  }

  /**
   * fetch() with a hard timeout. Without this, a hung connection
   * (common with flaky free APIs/proxies) would leave the UI stuck
   * on "Searching…" forever with no error ever surfacing.
   */
  async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const DIRECT_ATTEMPT_TIMEOUT_MS = 4000; // fail fast - a CORS block rarely needs 10s to reveal itself
  const PROXY_ATTEMPT_TIMEOUT_MS = 5000; // per-proxy budget when trying sequentially

  /**
   * fetch() that, if the direct request fails, tries each CORS
   * proxy in sequence (not all at once) until one succeeds.
   *
   * DAY 26 FIX — this used to race all proxies in parallel via
   * Promise.any(), which seemed strictly faster. In practice, firing
   * 4 simultaneous requests at 4 different free proxy services (and
   * doing that on every single app request) looks like a burst/abuse
   * pattern to those services — confirmed directly: a diagnostics run
   * that fired proxy requests in parallel got back an HTTP 429 (rate
   * limited) from a proxy that works fine when hit once, in
   * isolation. Trying them one at a time, each with its own short
   * timeout, never puts concurrent load on any single proxy.
   */
  async function robustFetch(url) {
    try {
      return await fetchWithTimeout(url, DIRECT_ATTEMPT_TIMEOUT_MS);
    } catch (directErr) {
      console.warn(`Direct fetch failed (${directErr.message}) for ${url} \u2014 trying ${CORS_PROXIES.length} proxies one at a time`);
      let lastErr = directErr;
      for (const buildProxyUrl of CORS_PROXIES) {
        try {
          return await fetchWithTimeout(buildProxyUrl(url), PROXY_ATTEMPT_TIMEOUT_MS);
        } catch (proxyErr) {
          console.warn(`Proxy attempt failed (${proxyErr.message})`);
          lastErr = proxyErr;
        }
      }
      throw lastErr;
    }
  }

  let cache = { ts: 0, states: [] };
  let inflight = null;

  // ---------- Status tracking (for the "live source" indicator in the UI) ----------
  let lastStatus = { provider: null, ok: false, ts: 0, detail: null };
  function reportStatus(provider, ok, detail) {
    lastStatus = { provider, ok, ts: Date.now(), detail: detail || null };
  }
  function getStatus() {
    return lastStatus;
  }

  /**
   * Fetches OpenSky's ENTIRE global state list. Expensive (multi-MB
   * response) — only ever used as a last-resort fallback now (see
   * the Day 20 fix note at the top of this file), never as the
   * first thing tried for a single-flight lookup.
   */
  async function fetchAllStatesFromOpenSky() {
    const now = Date.now();
    if (now - cache.ts < CACHE_MS) return cache.states;
    if (inflight) return inflight;

    inflight = robustFetch(STATES_URL)
      .then((res) => {
        if (res.status === 429) throw new Error('RATE_LIMIT');
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        return res.json();
      })
      .then((data) => {
        const states = (data.states || []).map(rowToFlight);
        cache = { ts: Date.now(), states };
        return states;
      })
      .finally(() => {
        inflight = null;
      });

    return inflight;
  }

  function splitCallsign(cs) {
    const m = cs.match(/^([A-Z]+)0*(\d[\d]*)([A-Z]?)$/);
    if (!m) return null;
    return { letters: m[1], digits: m[2], suffix: m[3] };
  }

  function matchCandidates(states, candidates) {
    const parsedCandidates = candidates.map((c) => splitCallsign(c.toUpperCase())).filter(Boolean);
    const exact = states.filter((f) => {
      if (!f.callsign) return false;
      const parsed = splitCallsign(f.callsign.toUpperCase());
      if (!parsed) return false;
      return parsedCandidates.some((c) => c.letters === parsed.letters && c.digits === parsed.digits);
    });
    if (exact.length) return exact;
    return states.filter(
      (f) => f.callsign && candidates.some((c) => f.callsign.toUpperCase().includes(c.toUpperCase()))
    );
  }

  /**
   * Finds live flights matching any of several candidate callsign
   * patterns. Tries adsb.lol's targeted per-callsign lookup FIRST
   * (small, fast response) — only falls back to downloading
   * OpenSky's entire global state list if every candidate lookup
   * fails there. If BOTH fail, throws a DualFailureError carrying
   * both real reasons rather than masking one.
   */
  async function findByFlightNumber(candidates) {
    let adsbLolReason = null;
    try {
      const settled = await Promise.allSettled(candidates.map((c) => AdsbLol.findByCallsign(c)));
      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      if (!fulfilled.length) {
        const firstRejection = settled.find((r) => r.status === 'rejected');
        throw firstRejection.reason;
      }
      const merged = fulfilled.flatMap((r) => r.value);
      reportStatus('adsblol', true);
      const seen = new Set();
      const matches = merged.filter((f) => {
        if (seen.has(f.icao24)) return false;
        seen.add(f.icao24);
        return true;
      });
      if (matches.length) return matches;
      // adsb.lol answered successfully but genuinely found nothing —
      // still worth trying OpenSky's full list before reporting "no
      // matches", in case adsb.lol just doesn't have this aircraft.
      throw new Error('NO_MATCH');
    } catch (adsbErr) {
      adsbLolReason = describeError(adsbErr);
      if (adsbErr.message !== 'NO_MATCH') {
        console.warn('adsb.lol failed:', adsbLolReason, '\u2014 falling back to OpenSky\u2019s full state list');
      }
      try {
        const states = await fetchAllStatesFromOpenSky();
        reportStatus('opensky', true);
        return matchCandidates(states, candidates);
      } catch (openSkyErr) {
        const openSkyReason = describeError(openSkyErr);
        console.error('OpenSky fallback also failed:', openSkyReason);
        reportStatus(null, false, `adsb.lol: ${adsbLolReason}, OpenSky: ${openSkyReason}`);
        if (adsbLolReason === 'NO_MATCH') {
          // adsb.lol had no data AND OpenSky failed outright - surface
          // the OpenSky failure, since "no match" isn't really a
          // failure worth alarming about on its own.
          throw new DualFailureError(openSkyReason, 'no match found');
        }
        throw new DualFailureError(openSkyReason, adsbLolReason);
      }
    }
  }

  /**
   * Looks up one aircraft by its ICAO24 hex address (used to
   * refresh the currently tracked flight). Tries adsb.lol's direct
   * hex lookup first (targeted, fast), falls back to OpenSky's
   * cached global state list only if that fails.
   */
  async function getByIcao24(icao24) {
    let adsbLolReason = null;
    try {
      const flight = await AdsbLol.getByIcao24(icao24);
      if (flight) {
        reportStatus('adsblol', true);
        return flight;
      }
      throw new Error('NO_MATCH');
    } catch (adsbErr) {
      adsbLolReason = describeError(adsbErr);
      try {
        const states = await fetchAllStatesFromOpenSky();
        const found = states.find((f) => f.icao24 === icao24);
        reportStatus('opensky', true);
        return found || null;
      } catch (openSkyErr) {
        const openSkyReason = describeError(openSkyErr);
        reportStatus(null, false, `adsb.lol: ${adsbLolReason}, OpenSky: ${openSkyReason}`);
        throw new DualFailureError(openSkyReason, adsbLolReason);
      }
    }
  }

  // Separate short-lived cache per bbox key so the Airport Explorer's
  // and Live Map's frequent, geographically-scoped queries don't get
  // lumped in with (or invalidated by) the whole-globe cache above.
  const bboxCache = new Map();
  const BBOX_CACHE_MS = 9000;

  /**
   * Fetches state vectors within a bounding box — always scoped, so
   * this was never affected by the Day 20 "unbounded fetch" bug.
   * Tries OpenSky's own bbox query first, falls back to adsb.lol's
   * point+radius query if OpenSky fails.
   */
  async function fetchStatesInBbox(latMin, latMax, lonMin, lonMax) {
    const key = [latMin, latMax, lonMin, lonMax].map((n) => n.toFixed(2)).join(',');
    const cached = bboxCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < BBOX_CACHE_MS) return cached.states;

    let openSkyReason = null;
    try {
      const url = `${STATES_URL}?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;
      const res = await robustFetch(url);
      if (res.status === 429) throw new Error('RATE_LIMIT');
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      const states = (data.states || []).map(rowToFlight);
      bboxCache.set(key, { ts: now, states });
      reportStatus('opensky', true);
      return states;
    } catch (openSkyErr) {
      openSkyReason = describeError(openSkyErr);
      console.warn('OpenSky failed:', openSkyReason, '\u2014 falling back to adsb.lol');
      try {
        const states = await AdsbLol.fetchStatesInBbox(latMin, latMax, lonMin, lonMax);
        bboxCache.set(key, { ts: now, states });
        reportStatus('adsblol', true);
        return states;
      } catch (fallbackErr) {
        const adsbLolReason = describeError(fallbackErr);
        reportStatus(null, false, `OpenSky: ${openSkyReason}, adsb.lol: ${adsbLolReason}`);
        throw new DualFailureError(openSkyReason, adsbLolReason);
      }
    }
  }

  return { findByFlightNumber, getByIcao24, fetchStatesInBbox, getStatus, DualFailureError };
})();

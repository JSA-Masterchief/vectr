/**
 * opensky.js
 * ------------------------------------------------------------
 * Thin wrapper around The OpenSky Network's public REST API,
 * with automatic fallback to adsb.lol (see adsblol.js), and a
 * further fallback to CORS proxies (private, user-configured one
 * first if set, then public ones) if a request fails with what
 * looks like a browser-level network/CORS error.
 *
 * DAY 35 FIX — corsproxy.io, which had been the one consistently
 * working public proxy across many test runs, started returning
 * instant HTTP 401 responses. Confirmed via their own docs: they
 * moved to requiring an API key for reliable access. Removed from
 * the default unauthenticated fallback chain entirely — trying it
 * now just wastes a request on a guaranteed rejection. This is
 * exactly the risk of depending on shared free services: policy
 * can change with no warning. See customproxy.js / the footer's
 * "private proxy" link for the actually durable fix.
 * ------------------------------------------------------------
 */
const OpenSky = (() => {
  const STATES_URL = 'https://opensky-network.org/api/states/all';
  const CACHE_MS = 9000;

  // Public proxies, unauthenticated. corsproxy.io removed (Day 35 -
  // now requires a paid/keyed plan for reliable use). Both
  // remaining options have a poor track record too (thingproxy
  // fails near-instantly almost every test; allorigins mostly
  // times out) - the private proxy (CustomProxy, tried first below
  // if configured) is the only actually reliable path at this
  // point.
  const CORS_PROXIES = [
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];

  function withBust(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
  }

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
    if (typeof AdsbLol === 'undefined') return 'ADSBLOL_MODULE_MISSING';
    if (err.name === 'TypeError') return 'NETWORK_OR_CORS';
    return err.message || 'UNKNOWN_ERROR';
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal, cache: 'no-store' });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const DIRECT_ATTEMPT_TIMEOUT_MS = 2500;
  const PROXY_ATTEMPT_TIMEOUT_MS = 4000;

  /**
   * fetch() that, on direct failure, tries the user's own private
   * proxy first (if configured - dramatically more reliable), then
   * each public proxy in sequence (not in parallel - see Day 26:
   * firing them simultaneously triggers rate limits on shared
   * services).
   */
  async function robustFetch(url) {
    try {
      return await fetchWithTimeout(url, DIRECT_ATTEMPT_TIMEOUT_MS);
    } catch (directErr) {
      if (typeof CustomProxy !== 'undefined' && CustomProxy.has()) {
        try {
          console.warn('Trying your configured private proxy first...');
          return await fetchWithTimeout(withBust(CustomProxy.build(url)), PROXY_ATTEMPT_TIMEOUT_MS);
        } catch (customErr) {
          console.warn(`Private proxy failed (${customErr.message}) \u2014 falling back to public proxies`);
        }
      }
      console.warn(`Direct fetch failed (${directErr.message}) for ${url} \u2014 trying ${CORS_PROXIES.length} proxies one at a time`);
      let lastErr = directErr;
      for (const buildProxyUrl of CORS_PROXIES) {
        try {
          return await fetchWithTimeout(withBust(buildProxyUrl(url)), PROXY_ATTEMPT_TIMEOUT_MS);
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

  let lastStatus = { provider: null, ok: false, ts: 0, detail: null };
  function reportStatus(provider, ok, detail) {
    lastStatus = { provider, ok, ts: Date.now(), detail: detail || null };
  }
  function getStatus() {
    return lastStatus;
  }

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

  /** Prioritize the ICAO-style candidate (BAW15) over IATA-style (BA15) - that's what's actually broadcast. */
  function prioritizeIcaoStyle(candidates) {
    return [...candidates].sort((a, b) => {
      const aIcaoLike = /^[A-Z]{3}\d/.test(a.toUpperCase()) ? 0 : 1;
      const bIcaoLike = /^[A-Z]{3}\d/.test(b.toUpperCase()) ? 0 : 1;
      return aIcaoLike - bIcaoLike;
    });
  }

  /**
   * Finds live flights matching any of several candidate callsign
   * patterns. Checks candidates ONE AT A TIME (Day 32 - checking
   * simultaneously recreates the same rate-limit-triggering burst
   * problem as trying proxies in parallel), ICAO-style form first
   * (Day 33), via adsb.lol. Falls back to OpenSky's full global
   * list only if every candidate fails there.
   */
  async function findByFlightNumber(candidates) {
    candidates = prioritizeIcaoStyle(candidates);
    let adsbLolReason = null;
    try {
      let matches = [];
      let everSucceeded = false;
      for (const candidate of candidates) {
        try {
          const found = await AdsbLol.findByCallsign(candidate);
          everSucceeded = true;
          if (found.length) {
            matches = found;
            break;
          }
        } catch (candidateErr) {
          adsbLolReason = describeError(candidateErr);
        }
      }
      if (!everSucceeded) throw new Error(adsbLolReason || 'UNKNOWN_ERROR');
      reportStatus('adsblol', true);
      const seen = new Set();
      matches = matches.filter((f) => {
        if (seen.has(f.icao24)) return false;
        seen.add(f.icao24);
        return true;
      });
      if (matches.length) return matches;
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
          throw new DualFailureError(openSkyReason, 'no match found');
        }
        throw new DualFailureError(openSkyReason, adsbLolReason);
      }
    }
  }

  /**
   * Looks up one aircraft by ICAO24 hex. Tries adsb.lol's direct
   * hex lookup first, falls back to OpenSky's cached global list.
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

  const bboxCache = new Map();
  const BBOX_CACHE_MS = 9000;

  /**
   * Fetches state vectors within a bounding box (Airport Explorer /
   * Live Map). Tries adsb.lol first (Day 29 - OpenSky's bbox
   * endpoint has failed through every available channel across
   * every test run so far), falls back to OpenSky only if that
   * fails.
   */
  async function fetchStatesInBbox(latMin, latMax, lonMin, lonMax) {
    const key = [latMin, latMax, lonMin, lonMax].map((n) => n.toFixed(2)).join(',');
    const cached = bboxCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < BBOX_CACHE_MS) return cached.states;

    let adsbLolReason = null;
    try {
      const states = await AdsbLol.fetchStatesInBbox(latMin, latMax, lonMin, lonMax);
      bboxCache.set(key, { ts: now, states });
      reportStatus('adsblol', true);
      return states;
    } catch (adsbErr) {
      adsbLolReason = describeError(adsbErr);
      console.warn('adsb.lol failed:', adsbLolReason, '\u2014 falling back to OpenSky');
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
        const openSkyReason = describeError(openSkyErr);
        reportStatus(null, false, `adsb.lol: ${adsbLolReason}, OpenSky: ${openSkyReason}`);
        throw new DualFailureError(openSkyReason, adsbLolReason);
      }
    }
  }

  return { findByFlightNumber, getByIcao24, fetchStatesInBbox, getStatus, DualFailureError };
})();

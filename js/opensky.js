/**
 * opensky.js
 * ------------------------------------------------------------
 * Thin wrapper around The OpenSky Network's public REST API,
 * with automatic fallback to adsb.lol (see adsblol.js), and a
 * further fallback through a public CORS proxy if a request
 * fails with what looks like a browser-level network/CORS error
 * rather than a clean HTTP error from the server itself.
 *
 * IMPORTANT FIX vs the previous version: when both providers
 * failed, this used to always re-throw OpenSky's error message,
 * discarding adsb.lol's actual failure reason. That made "both
 * providers broken" look identical to "OpenSky broken" in the UI,
 * which made real diagnosis impossible. This version surfaces
 * both reasons distinctly (see DualFailureError below) so the
 * on-screen message — and the browser console — actually says
 * what happened to each provider.
 *
 * The public function names/signatures here
 * (`findByFlightNumber`, `getByIcao24`, `fetchStatesInBbox`) are
 * what app.js / airportview.js / livemap.js call — kept stable
 * on purpose so swapping/adding providers never requires touching
 * those files.
 * ------------------------------------------------------------
 */
const OpenSky = (() => {
  const STATES_URL = 'https://opensky-network.org/api/states/all';
  const CACHE_MS = 9000; // don't hammer the API faster than this
  // A free, keyless CORS proxy, used ONLY as a last resort when a
  // direct fetch fails with what looks like a browser-level
  // network/CORS error (a TypeError from fetch()), not for normal
  // HTTP error responses (429/4xx/5xx), which a proxy won't fix.
  const CORS_PROXY = 'https://api.codetabs.com/v1/proxy/?quest=';

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
      super(`OpenSky: ${openSkyReason} · adsb.lol: ${adsbLolReason}`);
      this.name = 'DualFailureError';
      this.openSkyReason = openSkyReason;
      this.adsbLolReason = adsbLolReason;
      this.isRateLimit = openSkyReason === 'RATE_LIMIT' && adsbLolReason === 'RATE_LIMIT';
    }
  }

  function describeError(err) {
    if (err.message === 'RATE_LIMIT') return 'RATE_LIMIT';
    // A fetch() TypeError ("Failed to fetch", "NetworkError...") is
    // the classic browser-side symptom of a CORS block or genuine
    // connectivity failure — worth distinguishing from a clean HTTP
    // error status the server actually sent back.
    if (err.name === 'TypeError') return 'NETWORK_OR_CORS';
    return err.message || 'UNKNOWN_ERROR';
  }

  /**
   * fetch() that retries once through a public CORS proxy if the
   * direct request fails with a network/CORS-shaped error. HTTP
   * error responses (the server answered, just with a 429/4xx/5xx)
   * are NOT retried this way, since a proxy can't fix those.
   */
  async function robustFetch(url) {
    try {
      return await fetch(url);
    } catch (networkErr) {
      console.warn(`Direct fetch failed (${networkErr.name}: ${networkErr.message}), retrying via CORS proxy for:`, url);
      return await fetch(CORS_PROXY + encodeURIComponent(url));
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
   * patterns. Tries OpenSky first; on failure, falls back to
   * adsb.lol. If BOTH fail, throws a DualFailureError carrying both
   * real reasons rather than masking one.
   */
  async function findByFlightNumber(candidates) {
    let openSkyReason = null;
    try {
      const states = await fetchAllStatesFromOpenSky();
      reportStatus('opensky', true);
      return matchCandidates(states, candidates);
    } catch (openSkyErr) {
      openSkyReason = describeError(openSkyErr);
      console.warn('OpenSky failed:', openSkyReason, '— falling back to adsb.lol');
      try {
        const settled = await Promise.allSettled(candidates.map((c) => AdsbLol.findByCallsign(c)));
        const fulfilled = settled.filter((r) => r.status === 'fulfilled');
        if (!fulfilled.length) {
          // Every candidate lookup failed - throw the first real reason.
          const firstRejection = settled.find((r) => r.status === 'rejected');
          throw firstRejection.reason;
        }
        const merged = fulfilled.flatMap((r) => r.value);
        reportStatus('adsblol', true);
        const seen = new Set();
        return merged.filter((f) => {
          if (seen.has(f.icao24)) return false;
          seen.add(f.icao24);
          return true;
        });
      } catch (fallbackErr) {
        const adsbLolReason = describeError(fallbackErr);
        console.error('adsb.lol fallback also failed:', adsbLolReason);
        reportStatus(null, false, `OpenSky: ${openSkyReason}, adsb.lol: ${adsbLolReason}`);
        throw new DualFailureError(openSkyReason, adsbLolReason);
      }
    }
  }

  /**
   * Looks up one aircraft by its ICAO24 hex address. Tries
   * OpenSky's cached global state list first, falls back to
   * adsb.lol's direct hex lookup.
   */
  async function getByIcao24(icao24) {
    let openSkyReason = null;
    try {
      const states = await fetchAllStatesFromOpenSky();
      const found = states.find((f) => f.icao24 === icao24);
      if (found) {
        reportStatus('opensky', true);
        return found;
      }
      // Not in the current global snapshot — still worth trying
      // adsb.lol directly before giving up.
      const fallback = await AdsbLol.getByIcao24(icao24);
      reportStatus('adsblol', true);
      return fallback;
    } catch (openSkyErr) {
      openSkyReason = describeError(openSkyErr);
      console.warn('OpenSky failed:', openSkyReason, '— falling back to adsb.lol');
      try {
        const fallback = await AdsbLol.getByIcao24(icao24);
        reportStatus('adsblol', true);
        return fallback;
      } catch (fallbackErr) {
        const adsbLolReason = describeError(fallbackErr);
        reportStatus(null, false, `OpenSky: ${openSkyReason}, adsb.lol: ${adsbLolReason}`);
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
   * Fetches state vectors within a bounding box. Tries OpenSky's
   * own bbox query first, falls back to adsb.lol's point+radius
   * query if OpenSky fails.
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
      console.warn('OpenSky failed:', openSkyReason, '— falling back to adsb.lol');
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

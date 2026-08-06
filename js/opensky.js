/**
 * opensky.js
 * ------------------------------------------------------------
 * Thin wrapper around The OpenSky Network's public REST API
 * (https://opensky-network.org/apidoc/rest.html), with an
 * automatic fallback to adsb.lol (see adsblol.js) whenever
 * OpenSky itself fails — whether that's rate limiting, an
 * outage, or a CORS/network failure in a given browser. Both are
 * free and keyless; this file just tries one, then the other,
 * and normalizes both to the same flight object shape so nothing
 * else in the app needs to know or care which one actually
 * answered a given request.
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

  let cache = { ts: 0, states: [] };
  let inflight = null;

  // ---------- Status tracking (for the "live source" indicator in the UI) ----------
  let lastStatus = { provider: null, ok: false, ts: 0 };
  function reportStatus(provider, ok) {
    lastStatus = { provider, ok, ts: Date.now() };
  }
  function getStatus() {
    return lastStatus;
  }

  async function fetchAllStatesFromOpenSky() {
    const now = Date.now();
    if (now - cache.ts < CACHE_MS) return cache.states;
    if (inflight) return inflight;

    inflight = fetch(STATES_URL)
      .then((res) => {
        if (res.status === 429) throw new Error('RATE_LIMIT');
        if (!res.ok) throw new Error(`OpenSky responded ${res.status}`);
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
   * patterns (e.g. both "BA15" and its resolved ICAO form "BAW15"),
   * tolerant of leading-zero padding differences (e.g. "UAL123" vs
   * "UAL0123"). Tries OpenSky first; if that fails outright, falls
   * back to adsb.lol's dedicated callsign lookup, which is often
   * more precise anyway since it doesn't require brute-forcing the
   * whole global state list.
   */
  async function findByFlightNumber(candidates) {
    try {
      const states = await fetchAllStatesFromOpenSky();
      reportStatus('opensky', true);
      return matchCandidates(states, candidates);
    } catch (openSkyErr) {
      console.warn('OpenSky failed, falling back to adsb.lol:', openSkyErr.message);
      try {
        const results = await Promise.all(candidates.map((c) => AdsbLol.findByCallsign(c).catch(() => [])));
        const merged = results.flat();
        reportStatus('adsblol', true);
        // De-dupe by icao24 in case multiple candidates matched the
        // same aircraft (e.g. "BA15" and "BAW15" both hitting it).
        const seen = new Set();
        return merged.filter((f) => {
          if (seen.has(f.icao24)) return false;
          seen.add(f.icao24);
          return true;
        });
      } catch (fallbackErr) {
        console.error('adsb.lol fallback also failed:', fallbackErr.message);
        reportStatus(null, false);
        throw openSkyErr; // surface the original error's message to the UI
      }
    }
  }

  /**
   * Looks up one aircraft by its ICAO24 hex address (used for
   * re-fetching the currently tracked flight on refresh). Tries
   * OpenSky's cached global state list first, falls back to
   * adsb.lol's direct hex lookup.
   */
  async function getByIcao24(icao24) {
    try {
      const states = await fetchAllStatesFromOpenSky();
      const found = states.find((f) => f.icao24 === icao24);
      if (found) {
        reportStatus('opensky', true);
        return found;
      }
      // Not in the current global snapshot (e.g. cache is stale) —
      // still worth trying adsb.lol directly before giving up.
      const fallback = await AdsbLol.getByIcao24(icao24);
      reportStatus('adsblol', true);
      return fallback;
    } catch (openSkyErr) {
      console.warn('OpenSky failed, falling back to adsb.lol:', openSkyErr.message);
      try {
        const fallback = await AdsbLol.getByIcao24(icao24);
        reportStatus('adsblol', true);
        return fallback;
      } catch (fallbackErr) {
        reportStatus(null, false);
        throw fallbackErr;
      }
    }
  }

  // Separate short-lived cache per bbox key so the Airport Explorer's
  // and Live Map's frequent, geographically-scoped queries don't get
  // lumped in with (or invalidated by) the whole-globe cache above.
  const bboxCache = new Map();
  const BBOX_CACHE_MS = 9000;

  /**
   * Fetches state vectors within a bounding box — what powers the
   * "who's near this airport/on this map right now" views. Tries
   * OpenSky's own bbox query first, falls back to adsb.lol's
   * point+radius query (converted from the same box) if OpenSky
   * fails.
   */
  async function fetchStatesInBbox(latMin, latMax, lonMin, lonMax) {
    const key = [latMin, latMax, lonMin, lonMax].map((n) => n.toFixed(2)).join(',');
    const cached = bboxCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < BBOX_CACHE_MS) return cached.states;

    try {
      const url = `${STATES_URL}?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;
      const res = await fetch(url);
      if (res.status === 429) throw new Error('RATE_LIMIT');
      if (!res.ok) throw new Error(`OpenSky responded ${res.status}`);
      const data = await res.json();
      const states = (data.states || []).map(rowToFlight);
      bboxCache.set(key, { ts: now, states });
      reportStatus('opensky', true);
      return states;
    } catch (openSkyErr) {
      console.warn('OpenSky failed, falling back to adsb.lol:', openSkyErr.message);
      try {
        const states = await AdsbLol.fetchStatesInBbox(latMin, latMax, lonMin, lonMax);
        bboxCache.set(key, { ts: now, states });
        reportStatus('adsblol', true);
        return states;
      } catch (fallbackErr) {
        reportStatus(null, false);
        throw fallbackErr;
      }
    }
  }

  return { findByFlightNumber, getByIcao24, fetchStatesInBbox, getStatus };
})();

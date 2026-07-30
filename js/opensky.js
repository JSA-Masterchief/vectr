/**
 * opensky.js
 * ------------------------------------------------------------
 * Thin wrapper around The OpenSky Network's public REST API
 * (https://opensky-network.org/apidoc/rest.html).
 *
 * We use the anonymous /api/states/all endpoint, which returns
 * the live position of every aircraft currently reporting ADS-B
 * data worldwide. It does not support filtering by callsign, so
 * we fetch the full state vector list and match client-side.
 *
 * Anonymous access is rate-limited by OpenSky (subject to
 * change on their end — see their docs). If you hit limits or
 * see CORS errors in some browsers, the recommended fixes are:
 *   1. Create a free OpenSky account and swap in OAuth2 client
 *      credentials (see README "Upgrading your data source").
 *   2. Front this call with your own tiny serverless proxy.
 *
 * The provider is intentionally isolated in this one file so a
 * future contributor can swap in ADS-B Exchange, adsb.lol, or a
 * commercial API by reimplementing `fetchAllStates()` /
 * `findByCallsign()` with the same return shape.
 * ------------------------------------------------------------
 */
const OpenSky = (() => {
  const STATES_URL = 'https://opensky-network.org/api/states/all';
  const CACHE_MS = 9000; // don't hammer the API faster than this
  let cache = { ts: 0, states: [] };
  let inflight = null;

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

  async function fetchAllStates() {
    const now = Date.now();
    if (now - cache.ts < CACHE_MS) return cache.states;
    if (inflight) return inflight;

    inflight = fetch(STATES_URL)
      .then((res) => {
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

  /**
   * Finds live flights whose callsign matches the given query
   * (case-insensitive, partial match allowed so "BAW" surfaces
   * every current British Airways flight).
   */
  async function findByCallsign(query) {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const states = await fetchAllStates();
    return states.filter((f) => f.callsign && f.callsign.toUpperCase().includes(q));
  }

  function splitCallsign(cs) {
    const m = cs.match(/^([A-Z]+)0*(\d[\d]*)([A-Z]?)$/);
    if (!m) return null;
    return { letters: m[1], digits: m[2], suffix: m[3] };
  }

  /**
   * Finds live flights matching any of several candidate callsign
   * patterns (e.g. both "BA15" and its resolved ICAO form "BAW15"),
   * tolerant of leading-zero padding differences between how an
   * airline's flight number is written and how the transponder
   * actually zero-pads the callsign (e.g. "UAL123" vs "UAL0123").
   */
  async function findByFlightNumber(candidates) {
    const states = await fetchAllStates();
    const parsedCandidates = candidates
      .map((c) => splitCallsign(c.toUpperCase()))
      .filter(Boolean);

    const exact = states.filter((f) => {
      if (!f.callsign) return false;
      const parsed = splitCallsign(f.callsign.toUpperCase());
      if (!parsed) return false;
      return parsedCandidates.some(
        (c) => c.letters === parsed.letters && c.digits === parsed.digits
      );
    });
    if (exact.length) return exact;

    // Fall back to a plain substring match on the raw candidates,
    // so unusual callsign formats still surface something.
    const loose = states.filter(
      (f) => f.callsign && candidates.some((c) => f.callsign.toUpperCase().includes(c.toUpperCase()))
    );
    return loose;
  }

  async function getByIcao24(icao24) {
    const states = await fetchAllStates();
    return states.find((f) => f.icao24 === icao24) || null;
  }

  // Separate short-lived cache per bbox key so the Airport Explorer's
  // frequent, geographically-scoped queries don't get lumped in with
  // (or invalidated by) the whole-globe fetchAllStates() cache.
  const bboxCache = new Map();
  const BBOX_CACHE_MS = 9000;

  /**
   * Fetches only the state vectors within a bounding box — much
   * lighter than the global feed, and what powers the "who's near
   * this airport right now" live board.
   */
  async function fetchStatesInBbox(latMin, latMax, lonMin, lonMax) {
    const key = [latMin, latMax, lonMin, lonMax].map((n) => n.toFixed(2)).join(',');
    const cached = bboxCache.get(key);
    const now = Date.now();
    if (cached && now - cached.ts < BBOX_CACHE_MS) return cached.states;

    const url = `${STATES_URL}?lamin=${latMin}&lamax=${latMax}&lomin=${lonMin}&lomax=${lonMax}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenSky responded ${res.status}`);
    const data = await res.json();
    const states = (data.states || []).map(rowToFlight);
    bboxCache.set(key, { ts: now, states });
    return states;
  }

  return { fetchAllStates, findByCallsign, findByFlightNumber, getByIcao24, fetchStatesInBbox };
})();

/**
 * adsblol.js
 * ------------------------------------------------------------
 * Wrapper around adsb.lol's public OpenAPI (https://api.adsb.lol),
 * a free, keyless, community-run ADS-B network, ADSBExchange v2
 * format-compatible. As of Day 20, this is the PRIMARY path for
 * single-flight lookups (findByFlightNumber / getByIcao24 in
 * opensky.js) — its targeted callsign/hex endpoints return small,
 * fast responses, unlike OpenSky's unbounded global state list,
 * which chokes free CORS proxies on anything but a trivial test
 * query. OpenSky remains primary for bounding-box queries (Airport
 * Explorer / Live Map), which were never affected by that issue.
 *
 * adsb.lol's response units differ from OpenSky's (feet/knots/
 * feet-per-minute vs meters/m-per-second), so every function here
 * normalizes to the exact same flight object shape OpenSky uses,
 * so the rest of the app never needs to know which provider
 * actually answered.
 * ------------------------------------------------------------
 */
const AdsbLol = (() => {
  const BASE = 'https://api.adsb.lol/v2';
  const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  ];
  function withBust(url) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
  }
  const REQUEST_TIMEOUT_MS = 10000;

  async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
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

  const DIRECT_ATTEMPT_TIMEOUT_MS = 4000;
  const PROXY_ATTEMPT_TIMEOUT_MS = 5000;

  /** DAY 26: sequential, not parallel - see opensky.js for the full explanation. */
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
      console.warn(`adsb.lol direct fetch failed (${directErr.message}) \u2014 trying ${CORS_PROXIES.length} proxies one at a time`);
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

  function normalize(ac) {
    const onGround = ac.alt_baro === 'ground';
    const altFt = onGround ? 0 : ac.alt_baro;
    const altGeomFt = onGround ? 0 : ac.alt_geom;
    return {
      icao24: (ac.hex || '').toLowerCase(),
      callsign: (ac.flight || '').trim(),
      origin_country: null, // adsb.lol doesn't expose registration country
      time_position: ac.seen_pos != null ? Date.now() / 1000 - ac.seen_pos : null,
      last_contact: ac.seen != null ? Date.now() / 1000 - ac.seen : null,
      longitude: ac.lon ?? null,
      latitude: ac.lat ?? null,
      baro_altitude: typeof altFt === 'number' ? altFt * 0.3048 : null,
      on_ground: onGround,
      velocity: typeof ac.gs === 'number' ? ac.gs * 0.514444 : null,
      true_track: typeof ac.track === 'number' ? ac.track : null,
      vertical_rate: typeof ac.baro_rate === 'number' ? ac.baro_rate / 196.850394 : null,
      sensors: null,
      geo_altitude: typeof altGeomFt === 'number' ? altGeomFt * 0.3048 : null,
      squawk: ac.squawk || null,
      spi: false,
      position_source: 0,
      category: ac.category || null,
      registration: ac.r || null,
      aircraftType: ac.t || null,
      aircraftDescription: ac.desc || null,
    };
  }

  async function fetchJson(url) {
    const res = await robustFetch(url);
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.json();
  }

  async function findByCallsign(callsign) {
    const cs = callsign.trim().toUpperCase();
    if (!cs) return [];
    const data = await fetchJson(`${BASE}/callsign/${encodeURIComponent(cs)}`);
    return (data.ac || []).map(normalize);
  }

  async function getByIcao24(icao24) {
    const data = await fetchJson(`${BASE}/hex/${encodeURIComponent(icao24)}`);
    const list = (data.ac || []).map(normalize);
    return list[0] || null;
  }

  /**
   * adsb.lol's public OpenAPI does bounding-circle queries (point +
   * radius in nautical miles), not bounding boxes, so bbox callers
   * convert to a center point + radius that covers the box.
   */
  async function fetchStatesInBbox(latMin, latMax, lonMin, lonMax) {
    const centerLat = (latMin + latMax) / 2;
    const centerLon = (lonMin + lonMax) / 2;
    const kmPerDegLat = 111.32;
    const kmPerDegLon = 111.32 * Math.cos((centerLat * Math.PI) / 180);
    const halfLatKm = ((latMax - latMin) / 2) * kmPerDegLat;
    const halfLonKm = ((lonMax - lonMin) / 2) * Math.max(kmPerDegLon, 1);
    const radiusKm = Math.sqrt(halfLatKm ** 2 + halfLonKm ** 2);
    const radiusNm = Math.min(Math.max(radiusKm * 0.539957, 5), 250);

    const data = await fetchJson(`${BASE}/point/${centerLat.toFixed(4)}/${centerLon.toFixed(4)}/${Math.round(radiusNm)}`);
    return (data.ac || []).map(normalize);
  }

  const metadataCache = new Map();

  /**
   * Looks up just the static aircraft info (registration + type) for
   * an ICAO24 hex, regardless of which provider actually supplied
   * the live position. Cached indefinitely per session.
   */
  async function getAircraftMetadata(icao24) {
    if (metadataCache.has(icao24)) return metadataCache.get(icao24);
    try {
      const flight = await getByIcao24(icao24);
      const meta = flight
        ? {
            registration: flight.registration,
            aircraftType: flight.aircraftType,
            aircraftDescription: flight.aircraftDescription,
          }
        : null;
      metadataCache.set(icao24, meta);
      return meta;
    } catch {
      return null;
    }
  }

  return { findByCallsign, getByIcao24, fetchStatesInBbox, getAircraftMetadata };
})();

/**
 * adsblol.js
 * ------------------------------------------------------------
 * Wrapper around adsb.lol's public OpenAPI (https://api.adsb.lol),
 * a free, keyless, community-run ADS-B network, ADSBExchange v2
 * format-compatible. Used as an automatic fallback in opensky.js
 * when OpenSky itself fails (CORS, rate limit, outage, etc.) —
 * see opensky.js for the actual provider-selection logic.
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
  const CORS_PROXY = 'https://api.codetabs.com/v1/proxy/?quest=';
  const REQUEST_TIMEOUT_MS = 10000;

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function robustFetch(url) {
    try {
      return await fetchWithTimeout(url);
    } catch (networkErr) {
      console.warn(`adsb.lol direct fetch failed (${networkErr.message}), retrying via CORS proxy`);
      return await fetchWithTimeout(CORS_PROXY + encodeURIComponent(url));
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

  const metadataCache = new Map();

  /**
   * Looks up just the static aircraft info (registration + type) for
   * an ICAO24 hex, regardless of which provider actually supplied
   * the live position — this is purely supplemental and safe to
   * fail quietly, since OpenSky doesn't offer this for free at all.
   * Cached indefinitely per session since this data doesn't change.
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

  /**
   * adsb.lol's public OpenAPI does bounding-circle queries (point +
   * radius in nautical miles), not bounding boxes, so bbox callers
   * convert to a center point + radius that covers the box.
   */
  async function fetchStatesInBbox(latMin, latMax, lonMin, lonMax) {
    const centerLat = (latMin + latMax) / 2;
    const centerLon = (lonMin + lonMax) / 2;
    // Rough km-per-degree at this latitude, then to nautical miles.
    const kmPerDegLat = 111.32;
    const kmPerDegLon = 111.32 * Math.cos((centerLat * Math.PI) / 180);
    const halfLatKm = ((latMax - latMin) / 2) * kmPerDegLat;
    const halfLonKm = ((lonMax - lonMin) / 2) * Math.max(kmPerDegLon, 1);
    const radiusKm = Math.sqrt(halfLatKm ** 2 + halfLonKm ** 2);
    const radiusNm = Math.min(Math.max(radiusKm * 0.539957, 5), 250); // adsb.lol caps radius; keep it sane

    const data = await fetchJson(`${BASE}/point/${centerLat.toFixed(4)}/${centerLon.toFixed(4)}/${Math.round(radiusNm)}`);
    return (data.ac || []).map(normalize);
  }

  return { findByCallsign, getByIcao24, fetchStatesInBbox, getAircraftMetadata };
})();

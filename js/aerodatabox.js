/**
 * aerodatabox.js
 * ------------------------------------------------------------
 * OPTIONAL provider for real scheduled timetable data (flight
 * numbers, terminals, gates, scheduled/estimated times) via
 * AeroDataBox (https://aerodatabox.com), accessed through
 * RapidAPI's free tier.
 *
 * This is intentionally kept separate and opt-in:
 *   - No genuinely free, keyless, global schedule API exists —
 *     schedules are licensed data, unlike ADS-B positions.
 *   - AeroDataBox's free tier (a few hundred calls/month via
 *     RapidAPI, or a large free monthly quota via API.market) is
 *     the best real free tier we found for this.
 *   - The user's key is stored ONLY in this browser's
 *     localStorage and is sent ONLY to AeroDataBox's API — never
 *     to any other server. Because this is a static site with no
 *     backend, the key is visible in this browser's network tab;
 *     that's an acceptable tradeoff for a personal deployment,
 *     but don't reuse a key you care about protecting.
 * ------------------------------------------------------------
 */
const AeroDataBox = (() => {
  const KEY_STORAGE = 'vectr.aerodatabox.key';
  const BASE = 'https://aerodatabox.p.rapidapi.com';

  function getKey() {
    return localStorage.getItem(KEY_STORAGE) || '';
  }
  function setKey(key) {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
    cache.clear();
  }
  function hasKey() {
    return !!getKey();
  }

  function isoLocal(offsetHours, offsetMinutesFromNow = 0) {
    const d = new Date(Date.now() + offsetMinutesFromNow * 60000);
    return d.toISOString().slice(0, 16);
  }

  const cache = new Map();
  const CACHE_MS = 5 * 60 * 1000; // 5 min - schedules don't change second-to-second, and this is a metered free tier

  const REQUEST_TIMEOUT_MS = 10000;

  async function fetchOnce(icaoCode) {
    const key = getKey();
    const fromLocal = isoLocal(0, -60); // 1h ago
    const toLocal = isoLocal(0, 360); // +6h

    const url = `${BASE}/flights/airports/icao/${encodeURIComponent(
      icaoCode
    )}/${fromLocal}/${toLocal}?withLeg=true&direction=Both&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) throw new Error('BAD_KEY');
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);

    const data = await res.json();
    const departures = (data.departures || []).map(normalizeFlight('departure'));
    const arrivals = (data.arrivals || []).map(normalizeFlight('arrival'));
    return { departures, arrivals };
  }

  /**
   * Fetches scheduled departures & arrivals for an airport (by
   * ICAO code) in a window around now. Cached for 5 minutes per
   * airport (this is a metered free tier — no reason to spend a
   * call every time someone reopens the same airport), and retries
   * once after a short delay on a transient network failure (not
   * on BAD_KEY or RATE_LIMIT, which retrying won't fix). Throws on
   * missing key or a real HTTP failure so the caller can show a
   * clear message.
   */
  async function getSchedule(icaoCode) {
    const key = getKey();
    if (!key) throw new Error('NO_KEY');

    const cached = cache.get(icaoCode);
    if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

    try {
      const data = await fetchOnce(icaoCode);
      cache.set(icaoCode, { ts: Date.now(), data });
      return data;
    } catch (err) {
      if (err.message === 'BAD_KEY' || err.message === 'RATE_LIMIT') throw err;
      // One retry after a short pause for anything else (likely a
      // transient network blip), then give up and surface the error.
      await new Promise((r) => setTimeout(r, 1500));
      const data = await fetchOnce(icaoCode);
      cache.set(icaoCode, { ts: Date.now(), data });
      return data;
    }
  }

  function normalizeFlight(kind) {
    return (f) => ({
      kind,
      number: f?.number || f?.callSign || '—',
      airline: f?.airline?.name || '—',
      terminal: (kind === 'departure' ? f?.departure?.terminal : f?.arrival?.terminal) || '—',
      gate: (kind === 'departure' ? f?.departure?.gate : f?.arrival?.gate) || '—',
      scheduledTime:
        (kind === 'departure'
          ? f?.departure?.scheduledTime?.local
          : f?.arrival?.scheduledTime?.local) || null,
      status: f?.status || 'Scheduled',
      otherAirport:
        (kind === 'departure' ? f?.arrival?.airport?.name : f?.departure?.airport?.name) || '—',
    });
  }

  return { getKey, setKey, hasKey, getSchedule };
})();

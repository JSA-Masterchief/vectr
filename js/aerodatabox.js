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
  }
  function hasKey() {
    return !!getKey();
  }

  function isoLocal(offsetHours, offsetMinutesFromNow = 0) {
    const d = new Date(Date.now() + offsetMinutesFromNow * 60000);
    return d.toISOString().slice(0, 16);
  }

  /**
   * Fetches scheduled departures & arrivals for an airport (by
   * ICAO code) in a window around now. Throws on missing key or
   * HTTP failure so the caller can show a clear message.
   */
  async function getSchedule(icaoCode) {
    const key = getKey();
    if (!key) throw new Error('NO_KEY');

    const fromLocal = isoLocal(0, -60); // 1h ago
    const toLocal = isoLocal(0, 360); // +6h

    const url = `${BASE}/flights/airports/icao/${encodeURIComponent(
      icaoCode
    )}/${fromLocal}/${toLocal}?withLeg=true&direction=Both&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false`;

    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
    });

    if (res.status === 401 || res.status === 403) throw new Error('BAD_KEY');
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);

    const data = await res.json();
    const departures = (data.departures || []).map(normalizeFlight('departure'));
    const arrivals = (data.arrivals || []).map(normalizeFlight('arrival'));
    return { departures, arrivals };
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

/**
 * airports.js
 * ------------------------------------------------------------
 * Loads a trimmed, offline dataset of ~260 major world airports
 * (derived from the public-domain mwgg/Airports repository) so
 * Vectr can label origin/destination guesses and find "nearest
 * major airport" without needing a paid airports API.
 * ------------------------------------------------------------
 */
const Airports = (() => {
  let byIcao = {};
  let list = [];
  let loaded = null;

  async function load() {
    if (loaded) return loaded;
    loaded = fetch('data/airports.json')
      .then((r) => r.json())
      .then((data) => {
        byIcao = data;
        list = Object.values(data);
        return list;
      })
      .catch((err) => {
        console.error('Failed to load airports.json', err);
        return [];
      });
    return loaded;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Returns the nearest airport (from our major-airport set) to a lat/lon, with distance in km. */
  function nearest(lat, lon) {
    let best = null;
    let bestDist = Infinity;
    for (const a of list) {
      const d = haversineKm(lat, lon, a.lat, a.lon);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return best ? { airport: best, distanceKm: bestDist } : null;
  }

  function byIcaoCode(code) {
    return byIcao[code] || null;
  }

  /** Matches by IATA code, ICAO code, city, or airport name (case-insensitive). */
  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    // Exact code match first
    const exact = list.find(
      (a) => (a.iata && a.iata.toLowerCase() === q) || (a.icao && a.icao.toLowerCase() === q)
    );
    if (exact) return exact;
    // Otherwise substring match on city/name
    return (
      list.find(
        (a) =>
          (a.city && a.city.toLowerCase().includes(q)) ||
          (a.name && a.name.toLowerCase().includes(q))
      ) || null
    );
  }

  function all() {
    return list;
  }

  return { load, nearest, byIcaoCode, haversineKm, search, all };
})();

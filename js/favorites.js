/**
 * favorites.js
 * ------------------------------------------------------------
 * Client-side-only favorites for flights and airports. No
 * account, no backend, no sync across devices — just
 * localStorage, same spirit as the existing search history.
 * Kept as a small shared module since both app.js and
 * airportview.js (and the home screen) need to read/write it.
 * ------------------------------------------------------------
 */
const Favorites = (() => {
  const FLIGHTS_KEY = 'vectr.favorites.flights';
  const AIRPORTS_KEY = 'vectr.favorites.airports';

  function readList(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  }
  function writeList(key, list) {
    localStorage.setItem(key, JSON.stringify(list));
  }

  // ---------- Flights (stored as plain callsign strings) ----------
  function getFlights() {
    return readList(FLIGHTS_KEY);
  }
  function isFlightFavorited(callsign) {
    return getFlights().includes(callsign);
  }
  function toggleFlight(callsign) {
    if (!callsign) return false;
    let list = getFlights();
    const already = list.includes(callsign);
    list = already ? list.filter((c) => c !== callsign) : [callsign, ...list].slice(0, 20);
    writeList(FLIGHTS_KEY, list);
    return !already;
  }

  // ---------- Airports (stored as {code, name}) ----------
  function getAirports() {
    return readList(AIRPORTS_KEY);
  }
  function isAirportFavorited(code) {
    return getAirports().some((a) => a.code === code);
  }
  function toggleAirport(code, name) {
    if (!code) return false;
    let list = getAirports();
    const already = list.some((a) => a.code === code);
    list = already ? list.filter((a) => a.code !== code) : [{ code, name }, ...list].slice(0, 20);
    writeList(AIRPORTS_KEY, list);
    return !already;
  }

  return {
    getFlights,
    isFlightFavorited,
    toggleFlight,
    getAirports,
    isAirportFavorited,
    toggleAirport,
  };
})();

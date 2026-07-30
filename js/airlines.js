/**
 * airlines.js
 * ------------------------------------------------------------
 * Live ADS-B callsigns are (almost always) the airline's 3-letter
 * ICAO code + flight number, e.g. British Airways flight "BA15"
 * broadcasts the callsign "BAW15". Boarding passes, timetables,
 * and most people's mental model use the 2-letter IATA code
 * instead ("BA15"). FlightRadar24 and similar sites bridge this
 * with an airline code lookup table — so does Vectr, for free,
 * using the public OpenFlights airline dataset (~780 active
 * carriers with both codes).
 * ------------------------------------------------------------
 */
const Airlines = (() => {
  let byIata = {};
  let loaded = null;

  async function load() {
    if (loaded) return loaded;
    loaded = fetch('data/airlines.json')
      .then((r) => r.json())
      .then((data) => {
        byIata = data;
        return byIata;
      })
      .catch((err) => {
        console.error('Failed to load airlines.json', err);
        return {};
      });
    return loaded;
  }

  /** e.g. "BA" -> { icao: "BAW", name: "British Airways" } */
  function lookupIata(code) {
    return byIata[code.toUpperCase()] || null;
  }

  /**
   * Given raw user input, returns every callsign-prefix pattern
   * worth searching for. Handles three input shapes:
   *   "BA15"   (IATA flight number)   -> also try "BAW15"
   *   "BAW15"  (ICAO callsign)        -> used as-is
   *   "15"     (bare number)          -> used as-is (broad match)
   */
  function expandQuery(raw) {
    const q = raw.trim().toUpperCase().replace(/\s+/g, '');
    const candidates = new Set([q]);

    const m = q.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
    if (m) {
      const [, prefix, num] = m;
      const airline = lookupIata(prefix);
      if (airline) candidates.add(airline.icao + num);
    }
    return Array.from(candidates);
  }

  return { load, lookupIata, expandQuery };
})();

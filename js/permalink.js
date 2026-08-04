/**
 * permalink.js
 * ------------------------------------------------------------
 * Reads ?flight=CALLSIGN or ?airport=CODE from the URL on load
 * and jumps straight to that view. Pairs with the "🔗 Share"
 * buttons in app.js/airportview.js, which write these same
 * params via history.replaceState as you browse, so the address
 * bar is always a valid link back to what you're looking at.
 *
 * Loaded last (after app.js and airportview.js define
 * window.VectrTrackFlight / window.VectrOpenAirportByCode), so
 * both hooks are guaranteed to exist by the time this runs.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const flight = params.get('flight');
  const airport = params.get('airport');

  if (flight && window.VectrTrackFlight) {
    Views.show('app');
    window.VectrTrackFlight(flight);
  } else if (airport && window.VectrOpenAirportByCode) {
    Views.show('airport');
    window.VectrOpenAirportByCode(airport);
  }
})();

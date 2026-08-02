/**
 * views.js
 * ------------------------------------------------------------
 * Tiny shared router for the four top-level sections of the
 * single-page app (hero/search, flight tracker, airport
 * explorer, and the "how search works" tip). Kept separate so
 * app.js and airportview.js don't need to reach into each
 * other's DOM refs.
 * ------------------------------------------------------------
 */
const Views = (() => {
  function els() {
    return {
      hero: document.getElementById('heroSection'),
      app: document.getElementById('appView'),
      airport: document.getElementById('airportView'),
      livemap: document.getElementById('liveMapView'),
      tip: document.getElementById('emptyTip'),
    };
  }

  function show(name) {
    const e = els();
    // 'home' shows the hero + the "how search works" tip together.
    // 'app', 'airport', and 'livemap' are full takeovers of the main area.
    e.hero.hidden = name !== 'home';
    e.tip.hidden = name !== 'home';
    e.app.hidden = name !== 'app';
    e.airport.hidden = name !== 'airport';
    e.livemap.hidden = name !== 'livemap';
  }

  return { show };
})();

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

  const REASON_LABELS = {
    RATE_LIMIT: 'rate-limited',
    NETWORK_OR_CORS: 'unreachable from this browser (network/CORS)',
    TIMEOUT: 'timed out (no response in 10s)',
  };
  function labelFor(reason) {
    return REASON_LABELS[reason] || `error (${reason})`;
  }

  /**
   * Turns an OpenSky.DualFailureError into a precise message naming
   * what actually happened to each provider, instead of a generic
   * "something's wrong" line. Falls back to a generic message for
   * any other error shape.
   */
  function describeDualFailure(err) {
    if (err && err.name === 'DualFailureError') {
      if (err.isRateLimit) {
        return "Both free live-data providers (OpenSky and adsb.lol) are rate-limiting requests right now. Try again shortly.";
      }
      return `OpenSky is ${labelFor(err.openSkyReason)}; adsb.lol is ${labelFor(err.adsbLolReason)}. This is usually temporary.`;
    }
    return 'Could not reach live flight data right now — this is usually temporary. Try again shortly.';
  }

  return { show, describeDualFailure };
})();

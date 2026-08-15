/**
 * views.js
 * ------------------------------------------------------------
 * Tiny shared router for the top-level sections of the
 * single-page app: hero/search, flight tracker, airport
 * explorer, live map, connection diagnostics, and the "how
 * search works" tip. Kept separate so other scripts don't need
 * to reach into each other's DOM refs.
 *
 * DAY 20: diagnostics moved from a modal to a full view, same
 * as Airport Explorer / Live Map, since a modal was too cramped
 * for the amount of content it needed to show.
 * ------------------------------------------------------------
 */
const Views = (() => {
  function els() {
    return {
      hero: document.getElementById('heroSection'),
      app: document.getElementById('appView'),
      airport: document.getElementById('airportView'),
      livemap: document.getElementById('liveMapView'),
      diagnostics: document.getElementById('diagnosticsView'),
      tip: document.getElementById('emptyTip'),
    };
  }

  function show(name) {
    const e = els();
    // 'home' shows the hero + the "how search works" tip together.
    // 'app', 'airport', 'livemap', and 'diagnostics' are full
    // takeovers of the main area.
    e.hero.hidden = name !== 'home';
    e.tip.hidden = name !== 'home';
    e.app.hidden = name !== 'app';
    e.airport.hidden = name !== 'airport';
    e.livemap.hidden = name !== 'livemap';
    e.diagnostics.hidden = name !== 'diagnostics';
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  const REASON_LABELS = {
    RATE_LIMIT: 'rate-limited',
    NETWORK_OR_CORS: 'unreachable from this browser (network/CORS)',
    TIMEOUT: 'timed out (no response in 10s)',
    ADSBLOL_MODULE_MISSING: "couldn't load \u2014 check js/adsblol.js is present and loaded before js/opensky.js",
    NO_MATCH: 'found no data for this aircraft',
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
      return `OpenSky is ${labelFor(err.openSkyReason)}; adsb.lol is ${labelFor(err.adsbLolReason)}. This is usually temporary. Run the connection diagnostics (footer link) for a precise breakdown.`;
    }
    return 'Could not reach live flight data right now — this is usually temporary. Try again shortly.';
  }

  return { show, describeDualFailure };
})();

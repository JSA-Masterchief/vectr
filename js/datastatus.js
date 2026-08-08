/**
 * datastatus.js
 * ------------------------------------------------------------
 * Small always-visible indicator in the top bar showing which
 * free live-data provider actually answered the last request —
 * OpenSky, the adsb.lol fallback, or neither (reconnecting). Not
 * essential to any feature, but genuinely useful for knowing at a
 * glance whether you're seeing live data at all, and which source
 * is currently doing the work.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const dot = document.getElementById('dataStatusDot');
  const label = document.getElementById('dataStatusLabel');
  const POLL_MS = 4000;
  const STALE_MS = 60000; // if nothing succeeded in the last minute, show "no live data yet"

  function render() {
    const status = OpenSky.getStatus();
    const age = Date.now() - status.ts;

    if (!status.provider || !status.ok || age > STALE_MS) {
      dot.className = 'data-status-dot bad';
      label.textContent = status.ts ? 'Reconnecting…' : 'No live data yet';
      dot.parentElement.title = status.detail || 'Live data source';
      return;
    }

    dot.parentElement.title = 'Live data source';
    if (status.provider === 'opensky') {
      dot.className = 'data-status-dot good';
      label.textContent = 'Live: OpenSky';
    } else if (status.provider === 'adsblol') {
      dot.className = 'data-status-dot warn';
      label.textContent = 'Live: adsb.lol (backup)';
    }
  }

  render();
  setInterval(render, POLL_MS);
})();

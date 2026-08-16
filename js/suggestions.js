/**
 * suggestions.js
 * ------------------------------------------------------------
 * A first-time-user problem the search bar alone doesn't solve:
 * "type a flight number" is easy advice, but a new visitor has no
 * idea which flights are actually airborne right now. This adds a
 * small set of well-known, typically long-haul (and so usually
 * airborne somewhere in their journey) flight numbers as one-click
 * suggestions under the search bar.
 *
 * Deliberately standalone: only depends on window.VectrTrackFlight,
 * which app.js already exposes publicly — doesn't touch app.js
 * itself, so it can't regress anything there.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const container = document.getElementById('suggestionChips');
  const row = document.getElementById('suggestionsRow');
  if (!container) return;

  // A handful of long-haul flight numbers likely to be airborne at
  // most hours somewhere on their route. Not a guarantee — that's
  // the nature of live data — just better odds for a first try.
  const SUGGESTIONS = ['EK1', 'SQ1', 'QF1', 'BA15', 'UA1', 'AA100'];

  SUGGESTIONS.forEach((code) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = code;
    chip.addEventListener('click', () => {
      if (window.VectrTrackFlight) window.VectrTrackFlight(code);
    });
    container.appendChild(chip);
  });

  if (!SUGGESTIONS.length) row.style.display = 'none';
})();

/**
 * searchtimer.js
 * ------------------------------------------------------------
 * With flight-number candidates now checked sequentially (Day 32
 * fix) rather than all at once, a search can legitimately take a
 * few seconds when the first candidate doesn't match. Without any
 * feedback during that wait, a few seconds can feel like it's
 * frozen. This adds a small live "(Xs)" ticker next to the status
 * text while a search is in progress.
 *
 * Deliberately standalone: watches #searchStatus via
 * MutationObserver rather than modifying app.js (which owns that
 * element's text), so this can't regress the actual search logic
 * — worst case, if something about this breaks, the search status
 * text itself is completely unaffected.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const statusEl = document.getElementById('searchStatus');
  if (!statusEl) return;

  // A sibling element, not a child of #searchStatus — app.js
  // overwrites that element's textContent wholesale on every
  // update, which would wipe out any child we tried to inject.
  const timerEl = document.createElement('span');
  timerEl.className = 'search-timer';
  statusEl.insertAdjacentElement('afterend', timerEl);

  let intervalId = null;
  let startTs = 0;

  function isSearching(text) {
    return /searching/i.test(text);
  }

  function tick() {
    const elapsedSec = ((Date.now() - startTs) / 1000).toFixed(1);
    timerEl.textContent = `(${elapsedSec}s)`;
  }

  function start() {
    if (intervalId) return;
    startTs = Date.now();
    tick();
    intervalId = setInterval(tick, 100);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    timerEl.textContent = '';
  }

  const observer = new MutationObserver(() => {
    const text = statusEl.textContent || '';
    if (isSearching(text)) start();
    else stop();
  });
  observer.observe(statusEl, { childList: true, characterData: true, subtree: true });
})();

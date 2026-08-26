/**
 * shortcuts.js
 * ------------------------------------------------------------
 * Small set of keyboard shortcuts for people who'd rather not
 * reach for the mouse:
 *
 *   /        Focus the search box (from anywhere — backs out of
 *             the current view to Home first if needed)
 *   Escape   Close whichever modal is open, or back out of the
 *             current view to Home
 *   1        Jump to flight search (Home)
 *   2        Jump to Airport Explorer
 *   3        Jump to Live Map
 *
 * Standalone by design: only clicks existing public buttons (the
 * same ones a mouse would), so it can't regress anything in
 * app.js / airportview.js / livemap.js — none of those are touched.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  function isTypingInField(target) {
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function getActiveBackButton() {
    const ids = ['backBtn', 'airportBackBtn', 'liveMapBackBtn', 'diagnosticsBackBtn'];
    return ids
      .map((id) => document.getElementById(id))
      .find((btn) => btn && btn.offsetParent !== null);
  }

  function goHomeIfNeeded() {
    const heroSection = document.getElementById('heroSection');
    if (heroSection && heroSection.hidden) {
      const backBtn = getActiveBackButton();
      if (backBtn) backBtn.click();
    }
  }

  function getOpenModal() {
    return ['keyModal', 'proxyModal', 'mapModal']
      .map((id) => document.getElementById(id))
      .find((el) => el && !el.hidden);
  }

  // Explicit map, not a generic ".chip-btn" guess: keyModal and
  // proxyModal both have a destructive "Clear" button using the
  // same class as the safe "Cancel" button, and Clear comes first
  // in document order. A generic selector would trigger Clear
  // (deleting a saved key) instead of just closing the dialog.
  const MODAL_CLOSE_BUTTON_ID = {
    keyModal: 'keyCancelBtn',
    proxyModal: 'proxyCancelBtn',
    mapModal: 'mapModalCloseBtn',
  };

  function closeModal(modalEl) {
    const closeBtnId = MODAL_CLOSE_BUTTON_ID[modalEl.id];
    const closeBtn = closeBtnId && document.getElementById(closeBtnId);
    if (closeBtn) closeBtn.click();
    else {
      modalEl.hidden = true;
      modalEl.style.display = 'none';
    }
  }

  document.addEventListener('keydown', (e) => {
    // Never hijack keys while someone's actually typing, except
    // Escape (leaving an input field is exactly what it's for).
    if (isTypingInField(e.target) && e.key !== 'Escape') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'Escape': {
        const modal = getOpenModal();
        if (modal) {
          e.preventDefault();
          closeModal(modal);
          break;
        }
        const backBtn = getActiveBackButton();
        if (backBtn) {
          e.preventDefault();
          backBtn.click();
        }
        break;
      }
      case '/': {
        e.preventDefault();
        goHomeIfNeeded();
        const searchInput = document.getElementById('searchInput');
        setTimeout(() => searchInput && searchInput.focus(), 0);
        break;
      }
      case '1':
        goHomeIfNeeded();
        break;
      case '2': {
        const btn = document.getElementById('navAirports');
        if (btn) btn.click();
        break;
      }
      case '3': {
        const btn = document.getElementById('navLiveMap');
        if (btn) btn.click();
        break;
      }
    }
  });
})();

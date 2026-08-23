/**
 * proxysettings.js
 * ------------------------------------------------------------
 * The settings UI for the optional private proxy (see
 * customproxy.js for storage, cloudflare-worker.js for the
 * deployable script). Standalone and self-contained, same modal
 * pattern already used for the AeroDataBox key.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const link = document.getElementById('proxySettingsLink');
  const modal = document.getElementById('proxyModal');
  const input = document.getElementById('proxyUrlInput');
  const saveBtn = document.getElementById('proxySaveBtn');
  const clearBtn = document.getElementById('proxyClearBtn');
  const cancelBtn = document.getElementById('proxyCancelBtn');

  function open() {
    input.value = CustomProxy.get();
    modal.hidden = false;
    modal.style.display = 'flex';
  }
  function close() {
    modal.hidden = true;
    modal.style.display = 'none';
  }

  link.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  saveBtn.addEventListener('click', () => {
    CustomProxy.set(input.value);
    close();
  });
  clearBtn.addEventListener('click', () => {
    CustomProxy.set('');
    input.value = '';
    close();
  });
})();

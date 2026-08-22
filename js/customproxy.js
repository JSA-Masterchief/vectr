/**
 * customproxy.js
 * ------------------------------------------------------------
 * Optional support for a private, self-hosted CORS proxy (see
 * cloudflare-worker.js for the deployable script + instructions).
 * When a person has deployed their own, it's dramatically more
 * reliable than the shared public proxies Vectr falls back to by
 * default — no shared rate limits with anyone else. Stored only
 * in this browser's localStorage, same pattern as the AeroDataBox
 * key.
 * ------------------------------------------------------------
 */
const CustomProxy = (() => {
  const KEY = 'vectr.customProxyUrl';

  function get() {
    return (localStorage.getItem(KEY) || '').trim();
  }
  function set(url) {
    const trimmed = (url || '').trim().replace(/\/$/, '');
    if (trimmed) localStorage.setItem(KEY, trimmed);
    else localStorage.removeItem(KEY);
  }
  function has() {
    return !!get();
  }
  /** Builds a request URL through the configured private proxy. */
  function build(targetUrl) {
    const base = get();
    if (!base) return null;
    return `${base}?url=${encodeURIComponent(targetUrl)}`;
  }

  return { get, set, has, build };
})();

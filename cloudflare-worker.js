/**
 * Vectr private CORS proxy — Cloudflare Worker
 * ------------------------------------------------------------
 * Deploy this yourself (free, ~3 minutes, no credit card):
 *   1. Go to https://workers.cloudflare.com and sign up free.
 *   2. Dashboard → Workers & Pages → Create → Create Worker.
 *   3. Give it any name (e.g. "vectr-proxy") → Deploy.
 *   4. Click "Edit code", delete the placeholder, paste this
 *      entire file, click "Deploy" again.
 *   5. Copy your Worker's URL (looks like
 *      https://vectr-proxy.YOUR-SUBDOMAIN.workers.dev) and paste
 *      it into Vectr's "⚙ Proxy settings" (footer link).
 *
 * Why this is more reliable than the public proxies Vectr falls
 * back to: those are free services shared by everyone using them,
 * so they rate-limit hard and inconsistently. This Worker is
 * yours alone — Cloudflare's free tier gives 100,000 requests/day,
 * which is far more than one person's flight tracking will ever
 * use.
 *
 * Deliberately restricted to only proxy OpenSky and adsb.lol
 * (see ALLOWED_HOSTS) so it can't be used as an open proxy for
 * anything else, even though it's your own deployment.
 * ------------------------------------------------------------
 */
const ALLOWED_HOSTS = ['opensky-network.org', 'api.adsb.lol'];

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');

    if (!target) {
      return new Response('Missing ?url= parameter', { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Invalid target URL', { status: 400 });
    }

    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response(`Host not allowed: ${targetUrl.hostname}`, { status: 403 });
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'Vectr-Personal-Proxy/1.0' },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, { status: 502 });
    }
  },
};

// City Metro Alerts: Cloudflare Pages Function. Keep it at functions/citymetro/[[path]].js
//   browser calls      /citymetro/alerts/api/status
//   this calls         https://api.alerts.citymetro.xyz/api/status   with your API key
// Add the key to the Pages project as a Secret named CITYMETRO_API_KEY, then redeploy.

const API_HOST = "https://api.alerts.citymetro.xyz";
const ALLOWED = /^\/citymetro\/alerts(\/api\/(status|incidents|maintenance|lines|uptime))$/; // read-only public data
const CACHE_SECONDS = 5; // visitors share one upstream call, which saves your key's rate limit

export function onRequest(context) {
  return proxy(context.request, context.env, context);
}

async function proxy(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method !== "GET") return fail(405, "method_not_allowed");
  // Only pages on this same site may use the proxy. Browsers set these headers themselves.
  const fromThisSite = request.headers.get("Sec-Fetch-Site") === "same-origin" || request.headers.get("Origin") === url.origin;
  if (!fromThisSite) return fail(403, "forbidden");

  const match = ALLOWED.exec(url.pathname);
  if (!match) return fail(404, "not_found");

  const key = (env.CITYMETRO_API_KEY || "").trim();
  if (!key) return fail(503, "proxy_not_configured");

  const target = API_HOST + match[1]; // query strings are dropped; these routes take none
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(target);
  const cached = await cache?.match(cacheKey);
  if (cached) return forBrowser(cached);

  let upstream;
  try {
    // A fresh set of headers: visitor cookies and tokens are not forwarded.
    upstream = await fetch(target, { headers: { Accept: "application/json", "X-API-Key": key }, redirect: "manual" });
  } catch {
    return fail(502, "upstream_unreachable");
  }
  const headers = new Headers({ "Content-Type": upstream.headers.get("Content-Type") || "application/json" });
  const retry = upstream.headers.get("Retry-After");
  if (retry) headers.set("Retry-After", retry);
  const response = new Response(upstream.body, { status: upstream.status, headers });

  if (cache && upstream.status === 200) {
    response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return forBrowser(response);
}

function forBrowser(response) {
  const out = new Response(response.body, response);
  out.headers.set("Cache-Control", "no-store");
  return out;
}

function fail(status, error) {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

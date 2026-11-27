// City Metro API proxy for a Cloudflare Pages project.
// The browser calls   /citymetro/trip-planner/api/live
// This calls          https://api.trip-planner.citymetro.xyz/api/live   with your key.
// The key stays on the server: set CITYMETRO_API_KEY in the Pages project as an encrypted secret.

// Only these read-only routes can be reached with your key. Remove any this site doesn't use.
const ROUTES = {
  "trip-planner": {
    host: "https://api.trip-planner.citymetro.xyz",
    paths: /^\/api\/(live|network|streets|walk-links|advisories|alerts|plan|plan-alerts|lines(\/[\w-]+)?|stations(\/[\w-]+)?)$/,
  },
  alerts: {
    host: "https://api.alerts.citymetro.xyz",
    paths: /^\/api\/(status|incidents|maintenance|lines|uptime|announcement)$/,
  },
};
const CACHE_SECONDS = 5; // visitors share one upstream call, which saves your key's rate limit

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method !== "GET") return fail(405, "method_not_allowed");
  // Only pages on this same site may use the proxy. Browsers set these headers themselves.
  const fromThisSite = request.headers.get("Sec-Fetch-Site") === "same-origin" || request.headers.get("Origin") === url.origin;
  if (!fromThisSite) return fail(403, "forbidden");

  const match = /^\/citymetro\/([a-z-]+)(\/.*)$/.exec(url.pathname);
  const api = match && Object.hasOwn(ROUTES, match[1]) ? ROUTES[match[1]] : null;
  if (!api || !api.paths.test(match[2])) return fail(404, "not_found");

  const key = (env.CITYMETRO_API_KEY || "").trim();
  if (!key) return fail(503, "proxy_not_configured");

  const target = api.host + match[2] + url.search;
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
    context.waitUntil(cache.put(cacheKey, response.clone()));
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

/* global VERSION, ASSETS */
const PREFIX = "jwm-ui-";
const CACHE = PREFIX + VERSION;
const allowed = new Set(ASSETS);
const isPage = path => ["/", "/offline", "/realizacje", "/nowa-wycena", "/kalkulator", "/kalkulator/zapisane", "/logowanie", "/kalendarz", "/klienci", "/cenniki-i-ustawienia"].includes(path) || /^\/(?:kalkulator|nowa-wycena\/z-kalkulatora)\/[^/]+$/.test(path) || /^\/realizacje\/[^/]+(?:\/edytuj)?$/.test(path);

self.addEventListener("install", event => {
  // addAll fails atomically: a partial download must not replace a working shell.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload", credentials: "omit" })))));
  // No skipWaiting on install: the current form must keep its current version.
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Keep one predecessor for in-flight resources during a consented reload.
    const old = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE);
    await Promise.all(old.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type !== "ACTIVATE_UPDATE" || !event.source) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some(client => client.id !== event.source.id)) {
      event.source.postMessage({ type: "UPDATE_BLOCKED" });
      return;
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Cross-origin (including all Supabase services), authenticated requests,
  // writes, APIs, and cloud data bypass the worker altogether.
  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("authorization")) return;
  if (allowed.has(url.pathname) && !url.search && url.pathname !== "/offline") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(url.pathname)) || fetch(request);
    })());
    return;
  }
  if (!isPage(url.pathname) || (request.mode !== "navigate" && request.headers.get("rsc") !== "1")) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { signal: AbortSignal.timeout(8000) });
      if (response.ok) return response;
    } catch { /* Offline startup uses a single generic UI document. */ }
    // HTML for failed RSC requests makes Next perform a document navigation.
    // Never cache RSC or HTML responses with route/customer-specific content.
    const shell = await (await caches.open(CACHE)).match("/offline");
    // A fresh Response has no cached /offline URL, preserving the requested
    // quote URL when Next falls back from RSC to a full document navigation.
    if (!shell) return Response.error();
    const headers = new Headers(shell.headers);
    // Fetch exposes decoded bytes; do not carry wire compression/length into
    // the synthetic response served by the worker.
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("X-JWM-Offline-Shell", "1");
    return new Response(shell.body, { status: 200, headers });
  })());
});

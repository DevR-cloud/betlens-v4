// Bump this version to force all clients to get fresh files
const CACHE = "betlens-v3";
const ASSETS = ["/", "/index.html", "/app.v2.js", "/manifest.json", "/sync.html"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Never intercept cross-origin requests (e.g. SportyBet API calls)
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Network first for HTML, cache fallback for everything else
      if (e.request.mode === "navigate") {
        return fetch(e.request).catch(() => cached);
      }
      return cached || fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      });
    })
  );
});

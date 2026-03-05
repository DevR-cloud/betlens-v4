// Minimal service worker — just enough to make it installable as a PWA
// No caching, no fetch interception
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());

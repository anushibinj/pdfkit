/* pdfkit service worker. The precache list is injected at build time by
 * scripts/build-sw.mjs. Same-origin only: nothing here talks to other hosts. */
const PRECACHE = self.__PRECACHE_MANIFEST__;
const VERSION = self.__PRECACHE_VERSION__;
const CACHE = `pdfkit-${VERSION}`;
const OFFLINE_URL = "/offline/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Fetch each file fresh (bypassing the HTTP cache) so the precache is exact.
      await Promise.all(
        PRECACHE.map(async (url) => {
          const res = await fetch(url, { cache: "reload" });
          if (!res.ok) throw new Error(`Precache failed: ${url} (${res.status})`);
          await cache.put(url, res);
        }),
      );
    }),
  );
  // No skipWaiting here: the page asks for it so users can choose when to reload.
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("pdfkit-") && k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other origins

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) {
        // Turbopack passes its worker config in the URL fragment (#params=...).
        // A cached response carries a URL without the fragment, which would
        // become the worker's location. A synthetic response (empty URL) makes
        // the browser keep the original request URL.
        if (req.destination === "worker" || req.destination === "sharedworker") {
          return new Response(hit.body, {
            status: hit.status,
            statusText: hit.statusText,
            headers: hit.headers,
          });
        }
        return hit;
      }
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === "navigate") {
          const offline = await cache.match(OFFLINE_URL);
          if (offline) return offline;
        }
        throw err;
      }
    })(),
  );
});

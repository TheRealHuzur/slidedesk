// App-Stand: 96b915c6e195
// Service Worker: haelt die App fuer den Offline-Betrieb vor.
// Die Dateiliste und Version stehen in assets.json (erzeugt mit scripts/build-assets.mjs).
// CMaps (nur fuer seltene Schriften noetig) werden bei Bedarf nachgeladen und dann ebenfalls gespeichert.

const PREFIX = 'slidedesk-';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('assets.json', { cache: 'no-store' });
    const { version, files } = await res.json();
    const cache = await caches.open(PREFIX + version);
    await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('assets.json', { cache: 'no-store' }).catch(() => null);
    const current = res ? PREFIX + (await res.json()).version : null;
    if (current) {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== current && k !== PREFIX + 'extra') await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && req.url.includes('/vendor/')) (await caches.open(PREFIX + 'extra')).put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') return (await caches.match('./')) || Response.error();
      throw e;
    }
  })());
});

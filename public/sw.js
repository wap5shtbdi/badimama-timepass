// Small service worker: makes the app installable (Chrome's install prompt needs a fetch
// handler) and shows the app shell when there's no connection. Game traffic (/api/*,
// WebSockets) always goes to the network: the game is live, never cached.
const CACHE = 'marriage-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // only page loads
  // Network first, so a new version is picked up straight away; cached shell if offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone(); // before the page starts reading the body
          event.waitUntil(caches.open(CACHE).then((c) => c.put('/', copy)));
        }
        return res;
      })
      .catch(() => caches.match('/').then((r) => r || Response.error())),
  );
});

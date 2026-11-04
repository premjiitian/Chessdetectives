// Offline support: after the first visit, the app, Stockfish and Professor
// Pin's voice work without internet (puzzles from games already analyzed).
// chess.com, YouTube and Google are never cached here.
const CACHE = 'chess-detectives-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './icon.svg', './manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page tells us which files it already loaded (before we were active),
// so they are saved for offline use too.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'precache' || !Array.isArray(e.data.urls)) return;
  const own = e.data.urls.filter((u) => {
    try {
      return new URL(u).origin === self.location.origin && !u.endsWith('firebase-config.json');
    } catch {
      return false;
    }
  });
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(own.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // only our own files
  if (url.pathname.endsWith('/firebase-config.json')) return; // always fresh
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isPage) {
    // Pages: try the network first (to get updates), fall back to the saved copy.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreVary: true })),
    );
    return;
  }
  // Everything else (scripts, Stockfish, voice clips, icons): saved copy first.
  e.respondWith(
    caches.match(req, { ignoreVary: true, ignoreSearch: false }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

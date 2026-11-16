/* AmaVerde Crew — service worker (published copy only).
   - keeps the app (index.html, icons, manifest) so it starts offline
   - looks for a newer index.html only when the page asks ("check"); a newer one is stored at once and the
     page shows "A new version of the app is ready → Reload". Ignored: the next start uses the new version anyway.
   - crew data are never here: they stay in the browser's own storage on each device.
   - other addresses (weather, water levels, maps, relays) are not touched. */
const SW_VERSION = 'sw-2026-11-16a';
const CACHE = 'av-app';
const SCOPE = self.registration.scope;
const INDEX = new URL('index.html', SCOPE).href;
const ASSETS = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'].map(u => new URL(u, SCOPE).href);

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try { if (!(await c.match(INDEX))) { const r = await fetch(INDEX, { cache: 'no-cache' }); if (r.ok) await c.put(INDEX, r); } } catch (x) {}
    await Promise.all(ASSETS.map(async u => { try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await c.put(u, r); } catch (x) {} }));
  })());
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const isIndex = req => req.mode === 'navigate' || req.url.split(/[?#]/)[0] === INDEX || req.url.split(/[?#]/)[0] === SCOPE;

async function indexResponse() {
  const c = await caches.open(CACHE);
  const hit = await c.match(INDEX);
  if (hit) return hit;
  const r = await fetch(INDEX, { cache: 'no-cache' });
  if (r.ok) await c.put(INDEX, r.clone());
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = req.url.split('#')[0];
  if (!url.startsWith(SCOPE)) return;                       /* other sites: untouched */
  if (isIndex(req)) { e.respondWith(indexResponse().catch(() => fetch(req))); return; }
  const bare = url.split('?')[0];
  if (ASSETS.includes(bare)) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(bare)) || fetch(req).then(r => { if (r.ok) c.put(bare, r.clone()); return r; })));
  }
});

/* compare the stored index.html with the one on the server; store a newer one and tell every open window */
let checking = null;
async function check() {
  const c = await caches.open(CACHE);
  const r = await fetch(INDEX, { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const fresh = await r.clone().text();
  const old = await c.match(INDEX);
  const oldText = old ? await old.text() : null;
  if (oldText === fresh) return 'same';
  await c.put(INDEX, r);
  ASSETS.forEach(u => fetch(u, { cache: 'no-cache' }).then(x => { if (x.ok) c.put(u, x); }).catch(() => {}));
  if (oldText == null) return 'same';
  (await self.clients.matchAll({ type: 'window' })).forEach(w => w.postMessage({ type: 'av-update' }));
  return 'new';
}
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'check') {
    const port = e.ports && e.ports[0];
    checking = checking || check().finally(() => { checking = null; });
    checking.then(res => port && port.postMessage({ res, sw: SW_VERSION }), err => port && port.postMessage({ res: 'offline', err: String(err && err.message || err), sw: SW_VERSION }));
  }
});

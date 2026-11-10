/* 离线壳：仅在 HTTPS / localhost 下注册。
   本版没有服务端 API，页面、引擎、变体表全部缓存，断网后仍可检索与导入。 */
const CACHE = 'wenmaizaizi-offline-v3';
const SHELL = [
  './', './index.html', './app.css', './app.js',
  './offline-engine.js', './store.js', './importer.js', './variants.js',
  './vendor/fflate.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

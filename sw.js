// Paper Wing service worker: oyunun tüm dosyalarını telefona kaydeder, internetsiz de açılır.
// Oyunu güncellediğinde VERSION'ı artır ki telefonlar yeni sürümü indirsin.
var VERSION = 'paper-wing-v27';  // v27 = oyun sürümü 3.0
// v2.5: aynı alan adında test deposu da var → sadece KENDİ önbelleklerimizi silelim, sadece kendi önbelleğimizden okuyalım
var PREFIX = 'paper-wing-v';
var FILES = [
  './', 'index.html', 'manifest.webmanifest', 'game.js', 'render3d.js', 'ui.js', 'music.js', 'intro.js', 'online.js', 'ui.css', 'three.min.js',
  'fonts/bungee-latin-400-normal.woff2', 'fonts/anton-latin-400-normal.woff2', 'fonts/figtree-latin-400-normal.woff2',
  'fonts/figtree-latin-600-normal.woff2', 'fonts/figtree-latin-800-normal.woff2',
  'icons/icon-v2-192.png', 'icons/icon-v2-512.png', 'icons/maskable-v2-512.png', 'icons/apple-touch-icon-v2.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Önce önbellek, yoksa ağ
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VERSION).then(function (c) { return c.match(e.request, { ignoreSearch: true }); }).then(function (hit) { return hit || fetch(e.request); }));
});

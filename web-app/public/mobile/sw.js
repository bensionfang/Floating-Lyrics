/**
 * 行動版的 Service Worker (規格 §5.2):**只快取 app shell,API 一律走網路**。
 * 所以 fetch 只接 /mobile/ 底下的 GET,其餘 (含 /api/lyrics、Spotify 的兩支 API)
 * 直接不 respondWith,讓瀏覽器照常送出去。
 */

const CACHE = 'kanaric-mobile-v21';   // 改 shell 檔案時把版號往上加,activate 會清掉舊的
const SHELL = ['./', './index.html', './pkce.js', './playback.js', './lyrics.js',
               './color.js', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (!url.pathname.startsWith('/mobile/')) return;
  // 帶 query 的一律走網路:index.html 進場的喚醒 ping (manifest.json?wake=1) 就是靠這條
  // 才真的碰得到 server。走下面那段的話它會被 shell 快取接走,喚醒等於沒做。
  if (url.search) return;

  // cache-first + 背景更新:離線開得起來,有網路時下一次開就是新版
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((resp) => {
      if (resp.ok) caches.open(CACHE).then((c) => c.put(e.request, resp.clone()));
      return resp;
    }).catch((err) => hit || Promise.reject(err));   // 離線時沒接住會變成未處理的 rejection
    return hit || net;
  }));
});

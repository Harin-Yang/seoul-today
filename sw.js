// 오프라인·재방문 속도용 서비스 워커
// - 이 사이트 파일과 데이터: 네트워크 우선(항상 최신), 실패하면 캐시
// - CDN 라이브러리(Leaflet 등): 캐시 우선 (버전이 URL에 고정돼 있음)
const CACHE = 'seoul-today-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'data/events.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('index.html'))),
    );
    return;
  }

  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return res;
      })),
    );
  }
});

const CACHE_NAME = 'stenodex-v5.3';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './index.json',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            const response = await fetch('./index.json', { cache: 'no-cache' });
            const manifest = await response.json();
            const lessonFiles = Array.isArray(manifest) ? manifest : manifest.lessons;
            const urls = [...ASSETS, ...lessonFiles.map(fileName => `./${String(fileName).replace(/^\.\//, '')}`)];
            await cache.addAll(ASSETS);
            await Promise.all(urls.slice(ASSETS.length).map(async url => {
                try {
                    const lessonResponse = await fetch(url, { cache: 'no-cache' });
                    if (lessonResponse.ok) await cache.put(url, lessonResponse);
                } catch (error) {
                    console.warn('Unable to cache lesson:', url, error);
                }
            }));
            return cache;
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            if (event.request.method === 'GET' && networkResponse.ok) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
            }
            return networkResponse;
        }).catch(() => caches.match(event.request))
    );
});
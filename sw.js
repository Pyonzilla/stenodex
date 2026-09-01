const CACHE_NAME = 'stenodex-v5.8';
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
            await cache.addAll(ASSETS);
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
    cacheLessonsInBackground();
});

async function cacheLessonsInBackground() {
    try {
        const response = await fetch('./index.json', { cache: 'no-cache' });
        const manifest = await response.json();
        const lessonFiles = Array.isArray(manifest) ? manifest : manifest.lessons;
        if (!Array.isArray(lessonFiles)) return;
        const cache = await caches.open(CACHE_NAME);
        for (const fileName of lessonFiles) {
            if (typeof fileName !== 'string') continue;
            const url = `./${fileName.replace(/^\.\//, '')}`;
            try {
                const lessonResponse = await fetch(url, { cache: 'no-cache' });
                if (lessonResponse.ok) await cache.put(url, lessonResponse);
            } catch (error) {
                console.warn('Unable to cache lesson:', url, error);
            }
        }
    } catch (error) {
        console.warn('Unable to warm lesson cache:', error);
    }
}

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const networkRequest = fetch(event.request).then((networkResponse) => {
            if (event.request.method === 'GET' && networkResponse.ok) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
            }
            return networkResponse;
            });
            return cachedResponse || networkRequest;
        }).catch(() => caches.match(event.request))
    );
});

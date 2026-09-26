/**
 * THE SERVICE WORKER
 * ------------------
 * Keeps a copy of the app on the device so it opens with no signal. Only the
 * app itself is cached. Your photos and drafts live in IndexedDB, which this
 * file never touches, and song search always goes to the network.
 *
 * TO SHIP AN UPDATE: raise VERSION by one and push. The next time the phone
 * opens the app it fetches the new files, and the one after that runs them.
 * (Closing the app fully from the app switcher makes that second step happen
 * straight away.)
 */

const VERSION = 9;
const CACHE = `now-playing-v${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/model.js',
  'js/effects.js',
  'js/render.js',
  'js/color.js',
  'js/db.js',
  'js/itunes.js',
  'js/deezer.js',
  'js/search.js',
  'js/net.js',
  'js/links.js',
  'js/oembed.js',
  'js/export.js',
  'js/gestures.js',
  'js/screens/home.js',
  'js/screens/song.js',
  'js/screens/editor.js',
  'js/screens/exportscreen.js',
  'vendor/mediabunny-1.59.1.min.mjs',
  'assets/icons.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/fonts/instrument-serif-400.woff2',
  'assets/fonts/instrument-serif-400-italic.woff2',
  'assets/fonts/dm-sans-var.woff2',
  'assets/fonts/jetbrains-mono-var.woff2',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // One file failing should not stop the rest being cached.
      .then(cache => Promise.allSettled(SHELL.map(path => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Song search and cover art always go to the network. Caching them would
  // mean showing yesterday's catalogue.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) {
        // Serve the cached copy at once, and quietly refresh it for next time.
        fetch(request)
          .then(response => {
            if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response));
          })
          .catch(() => {});
        return hit;
      }
      return fetch(request).catch(() => caches.match('index.html'));
    }),
  );
});

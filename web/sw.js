/**
 * Service Worker.
 *
 * Aufgabe: die App selbst muss ohne Netz starten. Erfasste Daten liegen in
 * IndexedDB, nicht hier.
 *
 * Bewusste Festlegungen:
 *
 * * Anfragen an ``/api/`` werden **nie** zwischengespeichert. Ein alter
 *   Postbuchstand, der wie ein aktueller aussieht, wäre schlimmer als eine
 *   sichtbare Fehlermeldung.
 * * Belegfotos werden ebenfalls nicht zwischengespeichert; sie können
 *   vertraulich sein und gehören nicht in einen Browsercache.
 * * Die Bestandteile der Texterkennung werden dauerhaft gehalten, weil sie groß
 *   sind und offline gebraucht werden.
 */

const VERSION = 'postbuch-v1';
const SHELL = `${VERSION}-shell`;
const VENDOR = `${VERSION}-vendor`;

const SHELL_FILES = [
  '.',
  'index.html',
  'app.css',
  'js/app.js',
  'js/api.js',
  'js/db.js',
  'js/ocr.js',
  'js/adressen.js',
  'js/plz.js',
  'js/porto.js',
  // Die Postleitzahltabelle gehört zur App: die Prüfung soll auch ohne Netz
  // arbeiten – eine Poststelle im Keller hat oft keines.
  'daten/plz-orte.txt',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // stets direkt zum Server

  // Bestandteile der Texterkennung: einmal holen, dauerhaft behalten.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.open(VENDOR).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // App-Rumpf: erst Netz, dann Zwischenspeicher. So sind Aktualisierungen sofort
  // wirksam, und ohne Netz startet die App trotzdem.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        return new Response('Offline und nicht im Zwischenspeicher.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});

// Habitus — Service Worker
// STRATEGIA AGGIORNAMENTI:
// - File app (HTML/CSS/JS): network-first → sempre aggiornati, cache come fallback offline
// - Icone PNG: cache-first → cambiano rarissimamente
// - Firebase/gstatic: network-first, nessuna cache (gestito dall'SDK)
//
// Il nome della cache include la data di deploy così la vecchia cache
// viene eliminata automaticamente ad ogni aggiornamento.
// !! Aggiorna DEPLOY_DATE ad ogni push per invalidare la cache !!
const DEPLOY_DATE = '2026-01-01'; // <-- aggiorna ad ogni deploy
const CACHE = `habitus-${DEPLOY_DATE}`;

const APP_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
];

const STATIC_ASSETS = [
  './icon-192.png',
  './icon-512.png',
];

// ── Install: precache solo le icone statiche ──────────────────────
// I file app vengono popolati nella cache al primo accesso (network-first),
// non al momento dell'install — così non blocchiamo l'attivazione.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()) // attiva subito senza aspettare tab chiuse
  );
});

// ── Activate: elimina tutte le cache precedenti ───────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // prende controllo di tutte le tab aperte
  );
});

// ── Fetch ─────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Firebase, gstatic, googleapis: lascia passare senza cache SW
  // (il Firebase SDK ha la propria gestione offline via IndexedDB)
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('google.com')
  ) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Icone PNG: cache-first (cambiano solo con un nuovo deploy)
  if (url.pathname.endsWith('.png')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // Tutti gli altri file dell'app: network-first
  // → prova sempre la rete; se offline usa la cache
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Salva nella cache la risposta fresca
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request)) // offline fallback
  );
});

// ── Messaggio da app.js per forzare aggiornamento ─────────────────
// Quando app.js rileva un nuovo SW in attesa, manda 'SKIP_WAITING'
// e il SW si attiva immediatamente.
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

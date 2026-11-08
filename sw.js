// Cattle Meds — app shell offline cache
// Purpose: let the app itself open with zero signal OR on a slow/dead connection, by keeping a saved
// copy of the page and the outside libraries it depends on. This does NOT cache or interfere with
// Supabase data calls — those are handled separately by the app's own offline data logic.
//
// v2: if the network has not answered within 3 seconds and a saved copy exists, use the saved copy
// right away (the fresh copy keeps downloading in the background for next time). Only good (OK)
// responses are saved, so an error page can never replace a working copy.

const SHELL_CACHE = 'cattle-meds-shell-v2';
const WAIT_MS = 3000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name.startsWith('cattle-meds-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

function shouldHandle(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (request.mode === 'navigate') return true;          // the app page itself
  if (url.hostname === 'cdnjs.cloudflare.com') return true; // icon font + library files
  return false; // everything else (including all Supabase calls) passes straight through untouched
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!shouldHandle(request)) return; // not ours to handle — let the browser do its normal thing

  const network = fetch(request).then((response) => {
    if (response && (response.ok || response.type === 'opaque')) {
      const copy = response.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  });

  const fromCache = () => caches.match(request);

  // 1) network fails fast  -> saved copy (or the error if there is none)
  // 2) network is slow     -> after WAIT_MS use the saved copy if there is one, else keep waiting
  const afterNetworkFails = network.catch(() =>
    fromCache().then((cached) => {
      if (cached) return cached;
      throw new Error('Offline and no cached copy available for ' + request.url);
    })
  );
  const slowFallback = new Promise((resolve) => {
    setTimeout(() => { fromCache().then((cached) => resolve(cached || null)); }, WAIT_MS);
  });

  event.respondWith(
    Promise.race([afterNetworkFails, slowFallback]).then((first) => first || afterNetworkFails)
  );
  event.waitUntil(network.catch(() => {})); // let the background download finish
});

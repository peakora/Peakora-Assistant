const CACHE_VERSION = "v1";
const CACHE_NAME = `peakora-cache-${CACHE_VERSION}`;

const OFFLINE_URL = "./offline.html";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./assistant.html",
  "./assistant.css",
  "./manifest.json",
  "./offline.html",
  "./assets/peakora-icon-192.png",
  "./assets/peakora-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("peakora-cache-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then(response => {
        return response || caches.match(OFFLINE_URL);
      })
    )
  );
});

/* Web Push — gentle nudges delivered even when the app is closed */
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Peakora", {
      body: data.body || "A gentle nudge from your quiet corner.",
      icon: "./assets/peakora-icon-192.png",
      badge: "./assets/peakora-icon-192.png",
      tag: "peakora-nudge",
      renotify: false
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes("assistant") && "focus" in client) return client.focus();
      }
      return clients.openWindow("./assistant.html");
    })
  );
});

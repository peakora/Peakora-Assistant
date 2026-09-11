// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
const CACHE_VERSION = "2026-09-11-v57-lib-warmth-rabbitfix";
const CACHE_NAME = `peakora-cache-${CACHE_VERSION}`;

const OFFLINE_URL = "./offline.html";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./affiliate.html",
  "./assistant.css",
  "./css/styles.css",
  "./assistant",
  "./manifest.json",
  "./offline.html",
  "./service-worker.js",
  
  "./assets/peakora-logo.png",
  "./assets/hub-logo.png?v=6",
  "./cookie-banner.js?v=1"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll fails entirely if any file 404s, so add individually
      Promise.allSettled(FILES_TO_CACHE.map(f => cache.add(f)))
    )
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
  const req = event.request;
  const isSameOrigin = new URL( req.url ).origin === self.location.origin;
  const isGet = req.method === "GET";
  const isNavigate = req.mode === "navigate";
  if ( !isSameOrigin || !isGet || isNavigate ) {
    event.respondWith( fetch( req ).catch( () => Response.error() ) );
    return;
  }
  event.respondWith(
    fetch( req ).catch( () =>
      caches.match( req ).then( response => {
        return response || caches.match( OFFLINE_URL );
      } )
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
      icon: "./assets/hub-logo.png?v=6",
      badge: "./assets/hub-logo.png?v=6",
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

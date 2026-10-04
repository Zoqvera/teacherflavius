"use strict";

const CACHE_PREFIX = "teacher-flavius-pwa-";
const CACHE_VERSION = CACHE_PREFIX + "v1";
const INSTALL_ASSETS = Object.freeze([
  "/assets/favicon-192.png",
  "/assets/favicon-512.png",
  "/assets/favicon.svg",
  "/apple-touch-icon.png"
]);

function isInstallAsset(request) {
  if (!request || request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && INSTALL_ASSETS.includes(url.pathname);
}

async function refreshInstallAsset(request) {
  const response = await fetch(request);
  if (!response || !response.ok) return response;

  const cache = await caches.open(CACHE_VERSION);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(function (cache) {
        return cache.addAll(INSTALL_ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  if (!isInstallAsset(event.request)) return;

  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      return cachedResponse || refreshInstallAsset(event.request);
    })
  );
});

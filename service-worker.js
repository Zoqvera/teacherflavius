"use strict";

const CACHE_PREFIX = "teacher-flavius-pwa-";
const CACHE_VERSION = CACHE_PREFIX + "v2";
const DEFAULT_NOTIFICATION_URL = "/area-do-estudante/";
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

function parsePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch (_error) {
    return { body: event.data.text() };
  }
}

function safeNotificationUrl(value) {
  try {
    const url = new URL(String(value || DEFAULT_NOTIFICATION_URL), self.location.origin);
    return url.origin === self.location.origin
      ? url.pathname + url.search + url.hash
      : DEFAULT_NOTIFICATION_URL;
  } catch (_error) {
    return DEFAULT_NOTIFICATION_URL;
  }
}

async function openNotificationTarget(targetPath) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });

  for (const client of windows) {
    const clientUrl = new URL(client.url);
    if (clientUrl.origin !== self.location.origin) continue;
    if (typeof client.navigate === "function") {
      await client.navigate(targetPath);
    }
    return client.focus();
  }

  return self.clients.openWindow(targetPath);
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

self.addEventListener("push", function (event) {
  const payload = parsePushPayload(event);
  const targetUrl = safeNotificationUrl(payload.url);

  event.waitUntil(
    self.registration.showNotification(
      String(payload.title || "Teacher Flávio"),
      {
        body: String(payload.body || ""),
        icon: "/assets/favicon-192.png",
        badge: "/assets/favicon-192.png",
        tag: String(payload.tag || "teacher-flavio"),
        data: { url: targetUrl }
      }
    )
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const targetUrl = safeNotificationUrl(
    event.notification && event.notification.data
      ? event.notification.data.url
      : DEFAULT_NOTIFICATION_URL
  );
  event.waitUntil(openNotificationTarget(targetUrl));
});

(function () {
  "use strict";

  var VISITOR_KEY = "tf_marketing_visitor_v1";
  var TRACKING_EXCLUDED_KEY = "tf_marketing_tracking_excluded_v1";
  var AUTH_WAIT_ATTEMPTS = 30;
  var AUTH_WAIT_INTERVAL_MS = 100;

  function sleep(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();

    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }

    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");

    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function getOrCreateVisitorId() {
    var visitorId = safeGet(VISITOR_KEY);
    if (visitorId) return visitorId;

    visitorId = randomUuid();
    safeSet(VISITOR_KEY, visitorId);
    return visitorId;
  }

  async function waitForAuth() {
    for (var attempt = 0; attempt < AUTH_WAIT_ATTEMPTS; attempt += 1) {
      if (window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured && Auth.isConfigured()) return true;
      await sleep(AUTH_WAIT_INTERVAL_MS);
    }
    return !!(window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured && Auth.isConfigured());
  }

  async function excludeCurrentDevice() {
    if (!(await waitForAuth())) return;

    var session = await Auth.getSession();
    if (!session || !session.user) return;

    var visitorId = getOrCreateVisitorId();
    var response = await Auth.getClient().rpc("exclude_teacher_marketing_visitor", {
      target_visitor_id: visitorId
    });

    if (response.error) return;
    safeSet(TRACKING_EXCLUDED_KEY, "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", excludeCurrentDevice, { once: true });
  } else {
    excludeCurrentDevice();
  }
})();

(function () {
  "use strict";

  const DEFAULT_MAX_ATTEMPTS = 10;
  const DEFAULT_DELAY_MS = 100;
  const DEFAULT_SCRIPT_TIMEOUT_MS = 6000;

  function sleep(delayMs) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, delayMs);
    });
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return fallback;
    return number;
  }

  function shouldRunFinalCheck(settings) {
    return settings.finalCheck !== false;
  }

  async function waitUntil(predicate, options) {
    if (typeof predicate !== "function") {
      throw new TypeError("ResourceWaiter.waitUntil requer uma função de verificação.");
    }

    const settings = options || {};
    const maxAttempts = normalizePositiveInteger(settings.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    const delayMs = normalizePositiveInteger(settings.delayMs, DEFAULT_DELAY_MS);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (predicate()) return true;
      await sleep(delayMs);
    }

    return shouldRunFinalCheck(settings) ? !!predicate() : false;
  }

  function loadScript(options) {
    const settings = options || {};
    const timeoutMs = normalizePositiveInteger(
      settings.timeoutMs,
      DEFAULT_SCRIPT_TIMEOUT_MS
    );

    return new Promise(function (resolve) {
      if (settings.isReady()) {
        resolve(true);
        return;
      }

      let settled = false;
      let script = document.querySelector(settings.selector);

      function finish() {
        if (settled) return;
        settled = true;
        resolve(!!settings.isReady());
      }

      if (!script) {
        script = document.createElement("script");
        script.src = settings.src;
        script.defer = true;
        document.head.appendChild(script);
      }

      script.addEventListener("load", finish, { once: true });
      script.addEventListener("error", finish, { once: true });
      window.setTimeout(finish, timeoutMs);
    });
  }

  window.ResourceWaiter = Object.freeze({
    waitUntil: waitUntil,
    loadScript: loadScript
  });
})();

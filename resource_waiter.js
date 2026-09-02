(function () {
  "use strict";

  const DEFAULT_MAX_ATTEMPTS = 10;
  const DEFAULT_DELAY_MS = 100;

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

  window.ResourceWaiter = Object.freeze({
    waitUntil: waitUntil
  });
})();

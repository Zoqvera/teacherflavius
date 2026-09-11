(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PaymentIdempotency = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const STORAGE_PREFIX = "teacherflavius.payment.idempotency";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DETERMINISTIC_SERVER_CODES = new Set([
    "already_paid",
    "tuition_exempt",
    "mercado_pago_not_configured",
    "mercado_pago_pix_temporarily_unavailable",
    "mercado_pago_card_temporarily_unavailable",
    "mercado_pago_unauthorized",
  ]);

  function storageKey(userId, tuitionId) {
    return [STORAGE_PREFIX, String(userId || ""), String(tuitionId || "")].join(":");
  }

  function safeGet(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeSet(storage, key, value) {
    try {
      if (storage) storage.setItem(key, value);
    } catch (_) {}
  }

  function safeRemove(storage, key) {
    try {
      if (storage) storage.removeItem(key);
    } catch (_) {}
  }

  function load(storage, userId, tuitionId) {
    const value = safeGet(storage, storageKey(userId, tuitionId));
    return UUID_PATTERN.test(String(value || "")) ? value : null;
  }

  function getOrCreate(storage, userId, tuitionId, createUuid) {
    const existing = load(storage, userId, tuitionId);
    if (existing) return existing;

    const created = createUuid();
    if (!UUID_PATTERN.test(String(created || ""))) {
      throw new Error("Não foi possível gerar uma chave segura para o pagamento.");
    }
    safeSet(storage, storageKey(userId, tuitionId), created);
    return created;
  }

  function clear(storage, userId, tuitionId) {
    safeRemove(storage, storageKey(userId, tuitionId));
  }

  function shouldClearAfterFailure(failure) {
    const status = Number(failure && failure.status);
    const code = String((failure && failure.code) || "");
    if (DETERMINISTIC_SERVER_CODES.has(code)) return true;
    return Number.isFinite(status) && status >= 400 && status < 500;
  }

  return {
    clear: clear,
    getOrCreate: getOrCreate,
    load: load,
    shouldClearAfterFailure: shouldClearAfterFailure,
  };
});

"use strict";

const USER_ENDPOINT = "https://api.mercadolibre.com/users/me";
const DEFAULT_TIMEOUT_MS = 8000;

function cleanToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createAbortSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function probeCredential(options) {
  const settings = options || {};
  const token = cleanToken(settings.token);
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? settings.timeoutMs : DEFAULT_TIMEOUT_MS;

  if (!token) {
    return Object.freeze({ ok: false, skipped: true, reason: "missing_test_access_token" });
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is unavailable for Mercado Pago sandbox probe.");
  }

  let response;
  try {
    response = await fetchImpl(USER_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json"
      },
      signal: createAbortSignal(timeoutMs)
    });
  } catch (_error) {
    throw new Error("Mercado Pago sandbox credential probe could not reach the API.");
  }

  if (!response || response.ok !== true) {
    const status = response && Number.isFinite(response.status) ? response.status : 0;
    throw new Error("Mercado Pago sandbox credential probe failed with HTTP " + status + ".");
  }

  return Object.freeze({
    ok: true,
    skipped: false,
    authenticated: true,
    endpoint: "/users/me"
  });
}

async function runCli(environment) {
  const env = environment || process.env;
  const result = await probeCredential({ token: env.MERCADO_PAGO_TEST_ACCESS_TOKEN });
  if (result.skipped) {
    console.log("Mercado Pago sandbox probe skipped: test access token is not configured.");
    return result;
  }

  console.log("Mercado Pago sandbox credential probe succeeded with a read-only authenticated request.");
  return result;
}

if (require.main === module) {
  runCli(process.env).catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  DEFAULT_TIMEOUT_MS,
  USER_ENDPOINT,
  probeCredential,
  runCli
});

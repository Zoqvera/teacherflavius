"use strict";

const USER_ENDPOINT = "https://api.mercadolibre.com/users/me";
const CARD_TOKEN_ENDPOINT = "https://api.mercadopago.com/v1/card_tokens";
const PAYMENT_ENDPOINT = "https://api.mercadopago.com/v1/payments";
const DEFAULT_TIMEOUT_MS = 8000;
const TEST_DOCUMENT = Object.freeze({ type: "CPF", number: "12345678909" });

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanToken(value) {
  return cleanString(value);
}

function createAbortSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function requireSetting(value, name) {
  const cleaned = cleanString(value);
  if (!cleaned) throw new Error("Mercado Pago sandbox card probe requires " + name + ".");
  return cleaned;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createUuid(randomUuid) {
  if (typeof randomUuid === "function") return randomUuid();
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("Mercado Pago sandbox card probe requires crypto.randomUUID().");
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

async function requestJson(options) {
  const settings = options || {};
  const fetchImpl = settings.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? settings.timeoutMs : DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is unavailable for Mercado Pago sandbox card probe.");
  }

  let response;
  try {
    response = await fetchImpl(settings.url, {
      method: settings.method || "GET",
      headers: settings.headers || {},
      body: settings.body == null ? undefined : JSON.stringify(settings.body),
      signal: createAbortSignal(timeoutMs)
    });
  } catch (_error) {
    throw new Error("Mercado Pago sandbox card probe could not reach the API during " + settings.phase + ".");
  }

  let payload = null;
  if (response && typeof response.json === "function") {
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }
  }

  if (!response || response.ok !== true) {
    const status = response && Number.isFinite(response.status) ? response.status : 0;
    throw new Error("Mercado Pago sandbox card probe failed during " + settings.phase + " with HTTP " + status + ".");
  }

  return payload || {};
}

async function createCardToken(options) {
  const settings = options || {};
  const publicKey = requireSetting(settings.publicKey, "MERCADO_PAGO_TEST_PUBLIC_KEY");
  const card = settings.card || {};
  const holderName = requireSetting(settings.holderName, "test cardholder status");
  const payload = {
    card_number: requireSetting(card.number, "MERCADO_PAGO_TEST_CARD_NUMBER"),
    expiration_month: positiveNumber(card.expirationMonth, 0),
    expiration_year: positiveNumber(card.expirationYear, 0),
    security_code: requireSetting(card.securityCode, "MERCADO_PAGO_TEST_CARD_SECURITY_CODE"),
    cardholder: {
      name: holderName,
      identification: TEST_DOCUMENT
    }
  };

  if (!payload.expiration_month || !payload.expiration_year) {
    throw new Error("Mercado Pago sandbox card probe requires a valid test card expiration date.");
  }

  const response = await requestJson({
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs,
    phase: "card tokenization",
    url: CARD_TOKEN_ENDPOINT + "?public_key=" + encodeURIComponent(publicKey),
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: payload
  });

  const token = cleanString(response.id);
  if (!token) throw new Error("Mercado Pago sandbox card tokenization returned no token id.");
  return token;
}

async function createPayment(options) {
  const settings = options || {};
  const accessToken = requireSetting(settings.accessToken, "MERCADO_PAGO_TEST_ACCESS_TOKEN");
  return requestJson({
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs,
    phase: settings.phase || "payment creation",
    url: PAYMENT_ENDPOINT,
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Idempotency-Key": settings.idempotencyKey
    },
    body: settings.payload
  });
}

async function getPayment(options) {
  const settings = options || {};
  const accessToken = requireSetting(settings.accessToken, "MERCADO_PAGO_TEST_ACCESS_TOKEN");
  return requestJson({
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs,
    phase: "payment lookup",
    url: PAYMENT_ENDPOINT + "/" + encodeURIComponent(settings.paymentId),
    method: "GET",
    headers: {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json"
    }
  });
}

function paymentPayload(options) {
  return {
    transaction_amount: options.amount,
    token: options.cardToken,
    description: "TeacherFlavius sandbox card probe",
    installments: 1,
    payment_method_id: options.paymentMethodId,
    external_reference: options.externalReference,
    payer: {
      email: options.payerEmail,
      identification: TEST_DOCUMENT
    }
  };
}

async function probeCardPayments(options) {
  const settings = options || {};
  const accessToken = requireSetting(settings.accessToken, "MERCADO_PAGO_TEST_ACCESS_TOKEN");
  const publicKey = requireSetting(settings.publicKey, "MERCADO_PAGO_TEST_PUBLIC_KEY");
  const payerEmail = requireSetting(settings.payerEmail, "MERCADO_PAGO_TEST_PAYER_EMAIL");
  const paymentMethodId = cleanString(settings.paymentMethodId) || "master";
  const amount = positiveNumber(settings.amount, 10);
  const card = settings.card || {};
  const randomUuid = settings.randomUuid;

  const approvedKey = createUuid(randomUuid);
  const approvedToken = await createCardToken({
    publicKey,
    card,
    holderName: "APRO",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });
  const approvedPayload = paymentPayload({
    amount,
    cardToken: approvedToken,
    paymentMethodId,
    externalReference: "sandbox-card-approved-" + approvedKey,
    payerEmail
  });
  const approved = await createPayment({
    accessToken,
    idempotencyKey: approvedKey,
    payload: approvedPayload,
    phase: "approved payment creation",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });
  if (cleanString(approved.status) !== "approved" || !approved.id) {
    throw new Error("Mercado Pago sandbox approved scenario did not return an approved payment.");
  }

  const replay = await createPayment({
    accessToken,
    idempotencyKey: approvedKey,
    payload: approvedPayload,
    phase: "idempotent payment replay",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });
  if (String(replay.id || "") !== String(approved.id)) {
    throw new Error("Mercado Pago sandbox idempotency replay returned a different payment id.");
  }

  const lookup = await getPayment({
    accessToken,
    paymentId: approved.id,
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });
  if (String(lookup.id || "") !== String(approved.id) || cleanString(lookup.status) !== "approved") {
    throw new Error("Mercado Pago sandbox payment lookup did not confirm the approved payment.");
  }

  const rejectedKey = createUuid(randomUuid);
  const rejectedToken = await createCardToken({
    publicKey,
    card,
    holderName: "OTHE",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });
  const rejected = await createPayment({
    accessToken,
    idempotencyKey: rejectedKey,
    payload: paymentPayload({
      amount,
      cardToken: rejectedToken,
      paymentMethodId,
      externalReference: "sandbox-card-rejected-" + rejectedKey,
      payerEmail
    }),
    phase: "rejected payment creation",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });
  if (cleanString(rejected.status) !== "rejected" || !rejected.id) {
    throw new Error("Mercado Pago sandbox rejected scenario did not return a rejected payment.");
  }

  return Object.freeze({
    ok: true,
    approved_payment_id: String(approved.id),
    approved_status: cleanString(approved.status),
    replay_payment_id: String(replay.id),
    lookup_status: cleanString(lookup.status),
    rejected_payment_id: String(rejected.id),
    rejected_status: cleanString(rejected.status),
    idempotency_preserved: String(replay.id) === String(approved.id)
  });
}

function cardSettingsFromEnvironment(env) {
  return {
    accessToken: env.MERCADO_PAGO_TEST_ACCESS_TOKEN,
    publicKey: env.MERCADO_PAGO_TEST_PUBLIC_KEY,
    payerEmail: env.MERCADO_PAGO_TEST_PAYER_EMAIL,
    paymentMethodId: env.MERCADO_PAGO_TEST_PAYMENT_METHOD_ID || "master",
    amount: env.MERCADO_PAGO_TEST_AMOUNT || "10",
    card: {
      number: env.MERCADO_PAGO_TEST_CARD_NUMBER,
      securityCode: env.MERCADO_PAGO_TEST_CARD_SECURITY_CODE,
      expirationMonth: env.MERCADO_PAGO_TEST_CARD_EXPIRATION_MONTH,
      expirationYear: env.MERCADO_PAGO_TEST_CARD_EXPIRATION_YEAR
    }
  };
}

async function runCli(environment) {
  const env = environment || process.env;
  const result = await probeCredential({ token: env.MERCADO_PAGO_TEST_ACCESS_TOKEN });
  if (result.skipped) {
    if (env.MERCADO_PAGO_REQUIRE_TEST_CREDENTIAL === "true") {
      throw new Error("Mercado Pago sandbox test access token is not configured.");
    }
    console.log("Mercado Pago sandbox probe skipped: test access token is not configured.");
    return result;
  }

  console.log("Mercado Pago sandbox credential probe succeeded with a read-only authenticated request.");

  if (env.MERCADO_PAGO_SANDBOX_CARD_PROBE !== "true") return result;

  const cardResult = await probeCardPayments(cardSettingsFromEnvironment(env));
  console.log(JSON.stringify(cardResult));
  return cardResult;
}

if (require.main === module) {
  runCli(process.env).catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  CARD_TOKEN_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  PAYMENT_ENDPOINT,
  USER_ENDPOINT,
  cardSettingsFromEnvironment,
  createCardToken,
  createPayment,
  getPayment,
  probeCardPayments,
  probeCredential,
  runCli
});

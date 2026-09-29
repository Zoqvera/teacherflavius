"use strict";

const { randomUUID } = require("node:crypto");
const MercadoPagoProbe = require("./mercado_pago_sandbox_probe.js");

const PREAPPROVAL_ENDPOINT = "https://api.mercadopago.com/preapproval";
const AUTHORIZED_PAYMENT_SEARCH_ENDPOINT = "https://api.mercadopago.com/authorized_payments/search";
const PAYMENT_ENDPOINT = "https://api.mercadopago.com/v1/payments";
const REFERENCE_PREFIX = "sandbox-subscription-";
const DEFAULT_AMOUNT = 10;
const DEFAULT_POLL_INTERVAL_MS = 15000;
const DEFAULT_POLL_ATTEMPTS = 16;
const DEFAULT_PAYER_EMAIL = "test_payer@testuser.com";
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 5000];

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireSetting(value, name) {
  const cleaned = cleanString(value);
  if (!cleaned) throw new Error("Subscription sandbox probe requires " + name + ".");
  return cleaned;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise(function (resolve) {
    setTimeout(resolve, milliseconds);
  });
}

async function requestJson(options) {
  const retryDelays = options.retryDelaysMs || [];
  let attempt = 0;

  while (true) {
    const response = await fetch(options.url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs || 10000)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (response.ok) return payload || {};

    const canRetry =
      RETRYABLE_HTTP_STATUSES.has(response.status)
      && attempt < retryDelays.length;

    if (canRetry) {
      await sleep(retryDelays[attempt]);
      attempt += 1;
      continue;
    }

    const detail = payload && (payload.message || payload.error || payload.cause);
    const requestId =
      cleanString(response.headers.get("x-request-id"))
      || cleanString(response.headers.get("x-correlation-id"));
    throw new Error(
      options.phase + " failed with HTTP " + response.status
      + (detail ? ": " + JSON.stringify(detail).slice(0, 400) : "")
      + (requestId ? " [request_id=" + requestId + "]" : "")
    );
  }
}

function authHeaders(accessToken, extra) {
  return Object.assign({
    Authorization: "Bearer " + accessToken,
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-scope": "stage"
  }, extra || {});
}

function assertSandboxSubscription(subscription, expected) {
  if (!subscription || !subscription.id) {
    throw new Error("Subscription sandbox creation returned no subscription id.");
  }
  if (subscription.live_mode !== false) {
    throw new Error("Subscription sandbox unexpectedly returned live_mode=true.");
  }
  if (cleanString(subscription.external_reference) !== expected.externalReference) {
    throw new Error("Subscription sandbox external_reference mismatch.");
  }

  const recurring = subscription.auto_recurring || {};
  const amount = Number(recurring.transaction_amount);
  if (!Number.isFinite(amount) || amount.toFixed(2) !== expected.amount.toFixed(2)) {
    throw new Error("Subscription sandbox amount mismatch.");
  }
  if (cleanString(recurring.currency_id).toUpperCase() !== "BRL") {
    throw new Error("Subscription sandbox currency mismatch.");
  }

  const status = cleanString(subscription.status).toLowerCase();
  if (!["authorized", "pending"].includes(status)) {
    throw new Error("Unexpected subscription sandbox status: " + status);
  }
}

async function searchAuthorizedPayments(accessToken, subscriptionId) {
  const url = AUTHORIZED_PAYMENT_SEARCH_ENDPOINT
    + "?preapproval_id=" + encodeURIComponent(subscriptionId);
  const payload = await requestJson({
    phase: "authorized payment search",
    url,
    headers: authHeaders(accessToken)
  });

  return Array.isArray(payload.results) ? payload.results : [];
}

async function getPayment(accessToken, paymentId) {
  return requestJson({
    phase: "subscription payment lookup",
    url: PAYMENT_ENDPOINT + "/" + encodeURIComponent(paymentId),
    headers: authHeaders(accessToken)
  });
}

async function cancelSubscription(accessToken, subscriptionId) {
  const payload = await requestJson({
    phase: "subscription cleanup",
    url: PREAPPROVAL_ENDPOINT + "/" + encodeURIComponent(subscriptionId),
    method: "PUT",
    headers: authHeaders(accessToken),
    body: { status: "canceled" }
  });

  const status = cleanString(payload.status).toLowerCase();
  if (!["canceled", "cancelled"].includes(status)) {
    throw new Error("Subscription sandbox cleanup did not confirm canceled status.");
  }
  return payload;
}

function settingsFromEnvironment(env) {
  return {
    accessToken:
      env.MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN
      || env.MERCADO_PAGO_TEST_ACCESS_TOKEN,
    publicKey:
      env.MERCADO_PAGO_SUBSCRIPTION_STAGE_PUBLIC_KEY
      || env.MERCADO_PAGO_TEST_PUBLIC_KEY,
    payerEmail: DEFAULT_PAYER_EMAIL,
    amount: env.MERCADO_PAGO_TEST_AMOUNT || String(DEFAULT_AMOUNT),
    pollIntervalMs: env.MERCADO_PAGO_SUBSCRIPTION_POLL_INTERVAL_MS,
    pollAttempts: env.MERCADO_PAGO_SUBSCRIPTION_POLL_ATTEMPTS,
    card: {
      number: env.MERCADO_PAGO_TEST_CARD_NUMBER,
      securityCode: env.MERCADO_PAGO_TEST_CARD_SECURITY_CODE,
      expirationMonth: env.MERCADO_PAGO_TEST_CARD_EXPIRATION_MONTH,
      expirationYear: env.MERCADO_PAGO_TEST_CARD_EXPIRATION_YEAR
    }
  };
}

async function runSubscriptionProbe(options) {
  const settings = options || {};
  const accessToken = requireSetting(
    settings.accessToken,
    "MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN",
  );
  const publicKey = requireSetting(
    settings.publicKey,
    "MERCADO_PAGO_SUBSCRIPTION_STAGE_PUBLIC_KEY",
  );
  const payerEmail = requireSetting(
    settings.payerEmail,
    "subscription stage payer e-mail",
  );
  if (payerEmail !== DEFAULT_PAYER_EMAIL) {
    throw new Error("Subscription sandbox probe must use the documented stage payer e-mail.");
  }

  const amount = positiveNumber(settings.amount, DEFAULT_AMOUNT);
  const pollIntervalMs = positiveNumber(settings.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  const pollAttempts = Math.max(
    1,
    Math.floor(positiveNumber(settings.pollAttempts, DEFAULT_POLL_ATTEMPTS))
  );
  const externalReference = REFERENCE_PREFIX + randomUUID();
  const idempotencyKey = randomUUID();

  const cardToken = await MercadoPagoProbe.createCardToken({
    publicKey,
    card: settings.card || {},
    holderName: "APRO"
  });

  const startDate = new Date(Date.now() + 120000).toISOString();
  let subscriptionId = "";
  let cleanupStatus = "";

  try {
    const created = await requestJson({
      phase: "subscription creation",
      url: PREAPPROVAL_ENDPOINT,
      method: "POST",
      headers: authHeaders(accessToken, {
        "X-Idempotency-Key": idempotencyKey
      }),
      retryDelaysMs: RETRY_DELAYS_MS,
      body: {
        reason: "TeacherFlavius subscription sandbox probe",
        external_reference: externalReference,
        payer_email: payerEmail,
        card_token_id: cardToken,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          start_date: startDate,
          transaction_amount: amount,
          currency_id: "BRL"
        },
        back_url: "https://teacherflavius.com/pagamento/?subscription=sandbox",
        status: "authorized"
      }
    });

    assertSandboxSubscription(created, { externalReference, amount });
    subscriptionId = String(created.id);

    const lookup = await requestJson({
      phase: "subscription lookup",
      url: PREAPPROVAL_ENDPOINT + "/" + encodeURIComponent(subscriptionId),
      headers: authHeaders(accessToken)
    });
    assertSandboxSubscription(lookup, { externalReference, amount });

    let authorizedPayment = null;
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const results = await searchAuthorizedPayments(accessToken, subscriptionId);
      authorizedPayment = results.find(function (item) {
        return String(item.preapproval_id || "") === subscriptionId
          && cleanString(item.external_reference) === externalReference;
      }) || null;

      if (authorizedPayment) break;
      if (attempt < pollAttempts - 1) await sleep(pollIntervalMs);
    }

    let paymentEvidence = null;
    if (authorizedPayment && authorizedPayment.payment && authorizedPayment.payment.id) {
      const paymentId = String(authorizedPayment.payment.id);
      const payment = await getPayment(accessToken, paymentId);
      if (String(payment.id || "") !== paymentId) {
        throw new Error("Subscription sandbox payment lookup returned another payment.");
      }
      if (payment.live_mode !== false) {
        throw new Error("Subscription sandbox payment unexpectedly returned live_mode=true.");
      }
      if (cleanString(payment.external_reference) !== externalReference) {
        throw new Error("Subscription sandbox payment external_reference mismatch.");
      }
      if (Number(payment.transaction_amount).toFixed(2) !== amount.toFixed(2)) {
        throw new Error("Subscription sandbox payment amount mismatch.");
      }

      paymentEvidence = {
        id: paymentId,
        status: cleanString(payment.status),
        status_detail: cleanString(payment.status_detail)
      };
    }

    return {
      ok: true,
      sandbox: true,
      subscription_id: subscriptionId,
      subscription_status: cleanString(lookup.status),
      live_mode: false,
      external_reference: externalReference,
      authorized_payment_observed: !!authorizedPayment,
      authorized_payment_id: authorizedPayment ? String(authorizedPayment.id || "") : null,
      payment: paymentEvidence,
      start_date: startDate
    };
  } finally {
    if (subscriptionId) {
      const canceled = await cancelSubscription(accessToken, subscriptionId);
      cleanupStatus = cleanString(canceled.status);
      console.log(JSON.stringify({
        sandbox_subscription_cleanup: true,
        subscription_id: subscriptionId,
        status: cleanupStatus
      }));
    }
  }
}

async function runCli(environment) {
  const result = await runSubscriptionProbe(
    settingsFromEnvironment(environment || process.env)
  );
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  runCli(process.env).catch(function (error) {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  AUTHORIZED_PAYMENT_SEARCH_ENDPOINT,
  DEFAULT_AMOUNT,
  DEFAULT_PAYER_EMAIL,
  PAYMENT_ENDPOINT,
  PREAPPROVAL_ENDPOINT,
  REFERENCE_PREFIX,
  runCli,
  runSubscriptionProbe,
  settingsFromEnvironment
});

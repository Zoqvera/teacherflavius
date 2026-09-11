"use strict";

const { randomUUID } = require("node:crypto");
const MercadoPagoProbe = require("./mercado_pago_sandbox_probe.js");

const TEST_DOCUMENT = Object.freeze({ type: "CPF", number: "12345678909" });
const SANDBOX_REFERENCE_PREFIX = "sandbox-card-";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireSetting(value, name) {
  const cleaned = cleanString(value);
  if (!cleaned) throw new Error("Mercado Pago sandbox convergence seed requires " + name + ".");
  return cleaned;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function requireSandboxExternalReference(value) {
  const reference = requireSetting(value, "MERCADO_PAGO_TEST_EXTERNAL_REFERENCE");
  if (!reference.startsWith(SANDBOX_REFERENCE_PREFIX)) {
    throw new Error("Mercado Pago sandbox convergence seed requires a sandbox-card- external reference.");
  }
  return reference;
}

function settingsFromEnvironment(env) {
  return {
    accessToken: env.MERCADO_PAGO_TEST_ACCESS_TOKEN,
    publicKey: env.MERCADO_PAGO_TEST_PUBLIC_KEY,
    payerEmail: env.MERCADO_PAGO_TEST_PAYER_EMAIL,
    paymentMethodId: env.MERCADO_PAGO_TEST_PAYMENT_METHOD_ID || "master",
    amount: env.MERCADO_PAGO_TEST_AMOUNT || "10",
    externalReference: env.MERCADO_PAGO_TEST_EXTERNAL_REFERENCE,
    card: {
      number: env.MERCADO_PAGO_TEST_CARD_NUMBER,
      securityCode: env.MERCADO_PAGO_TEST_CARD_SECURITY_CODE,
      expirationMonth: env.MERCADO_PAGO_TEST_CARD_EXPIRATION_MONTH,
      expirationYear: env.MERCADO_PAGO_TEST_CARD_EXPIRATION_YEAR
    }
  };
}

async function seedApprovedPayment(options) {
  const settings = options || {};
  const probe = settings.probe || MercadoPagoProbe;
  const accessToken = requireSetting(settings.accessToken, "MERCADO_PAGO_TEST_ACCESS_TOKEN");
  const publicKey = requireSetting(settings.publicKey, "MERCADO_PAGO_TEST_PUBLIC_KEY");
  const payerEmail = requireSetting(settings.payerEmail, "MERCADO_PAGO_TEST_PAYER_EMAIL");
  const paymentMethodId = cleanString(settings.paymentMethodId) || "master";
  const amount = positiveNumber(settings.amount, 10);
  const externalReference = requireSandboxExternalReference(settings.externalReference);
  const card = settings.card || {};
  const idempotencyKey = typeof settings.randomUuid === "function"
    ? settings.randomUuid()
    : randomUUID();

  const cardToken = await probe.createCardToken({
    publicKey,
    card,
    holderName: "APRO",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });

  const payment = await probe.createPayment({
    accessToken,
    idempotencyKey,
    phase: "reconciliation convergence payment creation",
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs,
    payload: {
      transaction_amount: amount,
      token: cardToken,
      description: "TeacherFlavius sandbox reconciliation convergence probe",
      installments: 1,
      payment_method_id: paymentMethodId,
      external_reference: externalReference,
      payer: {
        email: payerEmail,
        identification: TEST_DOCUMENT
      }
    }
  });

  if (cleanString(payment.status) !== "approved" || !payment.id) {
    throw new Error("Mercado Pago sandbox convergence seed did not create an approved payment.");
  }

  const lookup = await probe.getPayment({
    accessToken,
    paymentId: payment.id,
    fetchImpl: settings.fetchImpl,
    timeoutMs: settings.timeoutMs
  });

  if (
    String(lookup.id || "") !== String(payment.id)
    || cleanString(lookup.status) !== "approved"
    || cleanString(lookup.external_reference) !== externalReference
    || lookup.live_mode !== false
  ) {
    throw new Error("Mercado Pago sandbox convergence seed lookup did not confirm an isolated approved payment.");
  }

  return Object.freeze({
    ok: true,
    external_reference: externalReference,
    payment_id: String(payment.id),
    status: cleanString(lookup.status),
    live_mode: false
  });
}

async function runCli(environment) {
  const env = environment || process.env;
  const result = await seedApprovedPayment(settingsFromEnvironment(env));
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
  SANDBOX_REFERENCE_PREFIX,
  seedApprovedPayment,
  settingsFromEnvironment,
  runCli
});

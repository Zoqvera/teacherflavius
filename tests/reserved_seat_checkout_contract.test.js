"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = source("supabase/migrations/20261030014630_expire_unpaid_reserved_seat_checkouts.sql");
const paymentPage = source("pagamento/index.html");
const paymentApp = source("pagamento/app.js");
const provider = source("supabase/functions/create-mercado-pago-payment/index.ts");

test("only reserved-seat first tuitions acquire a conditional payment window", () => {
  assert.match(migration, /join private\.class_seat_holds h on h\.id=access\.reserved_seat_hold_id/);
  assert.match(migration, /h\.status='claimed'/);
  assert.match(migration, /t\.reference_month=b\.billing_start_month/);
  assert.match(migration, /create trigger zzz_track_reserved_seat_payment_window/);
});

test("opening checkout starts a persistent server time limit of exactly ten minutes", () => {
  assert.match(migration, /entered_at=now\(\),expires_at=now\(\)\+interval '10 minutes'/);
  assert.match(migration, /if w\.state='awaiting_checkout'/);
  assert.match(migration, /for update/);
  assert.match(paymentApp, /start_my_reserved_seat_checkout/);
  assert.match(paymentApp, /reservedSeatCheckout\.expires_at/);
  assert.match(paymentPage, /id="reservedSeatCheckoutCountdown"/);
});

test("expired first payments release the student and pause billing without deleting receipts", () => {
  assert.match(migration, /cron\.schedule\('reserved-seat-first-payment-expiration'/);
  assert.match(migration, /set archived=true,archived_at/);
  assert.match(migration, /state='late_payment'/);
  assert.match(migration, /a\.applied_at is not null and a\.reversed_at is null/);
  assert.doesNotMatch(migration, /delete from public\.monthly_tuition/i);
});

test("payment provider checks the active reservation before charging the student", () => {
  assert.match(provider, /is_reserved_seat_checkout_allowed/);
  assert.match(provider, /reservedSeatPolicy === false/);
  assert.match(provider, /windowClosed && reservedSeatPolicy !== true/);
  assert.ok(
    provider.indexOf("is_reserved_seat_checkout_allowed") <
      provider.indexOf("if (tuition.payment_date)"),
    "provider must check the seat before creating or reusing an attempt"
  );
});

test("policy RPC is not executable by anonymous or regular authenticated users", () => {
  assert.match(migration, /grant execute on function public\.is_reserved_seat_checkout_allowed\(uuid,uuid\) to service_role/);
  assert.match(migration, /revoke all on private\.reserved_seat_payment_windows from public,anon,authenticated/);
  assert.match(migration, /enable row level security/);
});

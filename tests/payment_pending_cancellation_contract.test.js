const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const fn = read("supabase/functions/cancel-pending-mercado-pago-payment/index.ts");
const audit = read("supabase/migrations/20261009190621_audit_pending_pix_cancellations.sql");
const html = read("mensalidades/index.html");
const frontend = read("payment_pending_cancellations.js");
const operations = require("../payment_pending_cancellations.js");

test("cancellation requires an authenticated teacher and server-side credential", () => {
  assert.match(fn, /userClient\.rpc\("is_teacher_admin"\)/);
  assert.match(fn, /userClient\.auth\.getUser\(\)/);
  assert.match(fn, /isAdmin !== true/);
  assert.match(fn, /getDefaultKey\("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(fn, /MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(fn, /confirmation.*CONFIRMATION/);
  assert.doesNotMatch(frontend, /MERCADO_PAGO_ACCESS_TOKEN|SUPABASE_SECRET_KEYS/);
});

test("only unrecorded Pix attempts are eligible", () => {
  assert.match(fn, /row\.payment_method === "pix"/);
  assert.match(fn, /row\.applied_at === null && row\.reversed_at === null/);
  assert.match(fn, /\.in\("status", \[\.\.\.CANCELLABLE\]\)/);
  assert.match(fn, /\.is\("applied_at", null\)/);
  assert.match(fn, /\.is\("reversed_at", null\)/);
  assert.match(fn, /if \(!attempt \|\| !validAttempt\(attempt\)\)/);
});

test("server rechecks exact provider payment, amount and status before cancellation", () => {
  assert.match(fn, /payment\.external_reference === row\.id/);
  assert.match(fn, /String\(payment\.id \?\? ""\) === row\.provider_payment_id/);
  assert.match(fn, /amount\.toFixed\(2\) === Number\(row\.amount\)\.toFixed\(2\)/);
  assert.match(fn, /payment\.currency_id === "BRL"/);
  assert.match(fn, /if \(!CANCELLABLE\.has\(status\)\)/);
  assert.match(fn, /providerRequest\(token, attempt\.provider_payment_id, "GET"\)/);
  assert.match(fn, /providerRequest\(token, attempt\.provider_payment_id, "PUT"\)/);
  assert.match(fn, /JSON\.stringify\(\{ status: "cancelled" \}\)/);
  assert.match(fn, /if \(status === "cancelled"\)/);
  assert.match(fn, /await synchronizeCancelled\(admin, token, attempt\)/);
});

test("audit is private, requested before provider change, and retains outcome", () => {
  assert.match(audit, /create table public\.payment_cancellation_audit/);
  assert.match(audit, /enable row level security/);
  assert.match(audit, /revoke all on public\.payment_cancellation_audit from public, anon, authenticated/);
  assert.match(audit, /grant select, insert on public\.payment_cancellation_audit to service_role/);
  assert.match(fn, /await logCancellation\(admin, attempt, actorId, "requested", status\)/);
  assert.match(fn, /await logCancellation\(admin, attempt, actorId, "confirmed", "cancelled"\)/);
  assert.match(fn, /provider_unconfirmed/);
  assert.match(fn, /local_sync_pending/);
});

test("monthly tuition administration exposes an explicit cancellation panel", () => {
  assert.match(html, /id="pendingPixHeading"/);
  assert.match(html, /id="pendingPixList"/);
  assert.match(html, /id="refreshPendingPixButton"/);
  assert.match(html, /payment_pending_cancellations\.js\?v=/);
  assert.match(frontend, /Digite CANCELAR para confirmar/);
  assert.match(frontend, /action: "cancel"/);
  assert.match(frontend, /"CANCELAR PIX"/);
});

test("client filters malformed candidates and scopes month", () => {
  const good = {
    attempt_id: "abcd", student_name: "Aluna Exemplo", amount: 50, status: "pending"
  };
  const rows = operations.normalizeCandidates([good, null, { ...good, status: "approved" },
    { ...good, amount: "abc" }, { ...good, student_name: null }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].student_name, "Aluna Exemplo");
  assert.equal(operations.selectedMonth({
    getElementById: () => ({ value: "2026-10" })
  }), "2026-10-01");
});

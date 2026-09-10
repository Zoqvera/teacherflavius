const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const control = require("../payment_creation_control.js");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20260910022045_harden_global_defaults_and_add_payment_kill_switch.sql"),
  "utf8"
);

test("normalizes payment creation control state", function () {
  assert.deepEqual(control.normalizeControl({ enabled: false, reason: " manutenção ", updated_at: "2026-09-10T02:00:00Z" }), {
    enabled: false,
    reason: "manutenção",
    updatedAt: "2026-09-10T02:00:00Z"
  });
  assert.equal(control.statusLabel({ enabled: true }), "NOVAS COBRANÇAS ATIVAS");
  assert.equal(control.actionLabel({ enabled: false }), "REATIVAR NOVAS COBRANÇAS");
});

test("requires explicit textual confirmation before changing the kill switch", function () {
  const blockingAnswers = ["Indisponibilidade do gateway", "BLOQUEAR"];
  const blockWindow = { prompt: function () { return blockingAnswers.shift(); } };
  assert.deepEqual(control.requestTransition(blockWindow, { enabled: true }), {
    enabled: false,
    reason: "Indisponibilidade do gateway"
  });

  const enableWindow = { prompt: function () { return "REATIVAR"; } };
  assert.deepEqual(control.requestTransition(enableWindow, { enabled: false }), {
    enabled: true,
    reason: "Novas cobranças reativadas pelo professor."
  });

  const rejectedWindow = { prompt: function () { return "NÃO"; } };
  assert.equal(control.requestTransition(rejectedWindow, { enabled: false }), null);
});

test("database kill switch blocks new attempts and preserves recovery flows", function () {
  assert.match(migration, /create table if not exists private\.payment_creation_control/);
  assert.match(migration, /before insert on public\.tuition_payment_attempts/);
  assert.match(migration, /message = 'payment_creation_disabled'/);
  assert.match(migration, /provider_payment_id is null/);
  assert.match(migration, /status in \('created', 'pending', 'authorized', 'in_process', 'in_mediation'\)/);
  assert.doesNotMatch(migration, /disable.*reconcil/i);
  assert.doesNotMatch(migration, /unschedule/i);
});

test("global defaults no longer grant future app objects to client roles", function () {
  assert.match(migration, /alter default privileges for role postgres in schema public\s+revoke all privileges on tables from anon, authenticated;/);
  assert.match(migration, /alter default privileges for role postgres in schema public\s+revoke all privileges on sequences from anon, authenticated;/);
  assert.match(migration, /revoke execute on functions from public, anon, authenticated;/);
  assert.match(migration, /grant all privileges on tables to service_role;/);
});

test("technical marketing trigger is no longer an anonymous SECURITY DEFINER API", function () {
  assert.match(
    migration,
    /revoke execute on function public\.suppress_excluded_marketing_visitor_events\(\) from public, anon, authenticated;/
  );
  assert.doesNotMatch(migration, /revoke execute on function public\.get_public_quartet_vacancies/);
});

test("kill switch administration remains MFA protected", function () {
  assert.match(migration, /create or replace function public\.get_teacher_payment_creation_control\(\)/);
  assert.match(migration, /create or replace function public\.set_teacher_payment_creation_enabled/);
  const mfaChecks = migration.match(/if not public\.is_teacher_admin_mfa\(\) then/g) || [];
  assert.equal(mfaChecks.length >= 2, true);
  assert.match(migration, /revoke all on function public\.set_teacher_payment_creation_enabled\(boolean, text\) from public, anon;/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const control = require("../payment_creation_control.js");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260910022045_harden_global_defaults_and_add_payment_kill_switch.sql"),
  "utf8"
);
const edgeMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260910022758_move_payment_kill_switch_management_to_edge.sql"),
  "utf8"
);
const edgeSource = fs.readFileSync(
  path.join(root, "supabase/functions/manage-payment-creation-control/index.ts"),
  "utf8"
);
const browserSource = fs.readFileSync(path.join(root, "payment_creation_control.js"), "utf8");

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

test("final kill switch RPCs are service-role only", function () {
  assert.match(edgeMigration, /create or replace function public\.get_payment_creation_control_internal\(\)/);
  assert.match(edgeMigration, /create or replace function public\.set_payment_creation_enabled_internal/);
  assert.match(edgeMigration, /revoke all on function public\.get_payment_creation_control_internal\(\) from public, anon, authenticated;/);
  assert.match(edgeMigration, /grant execute on function public\.get_payment_creation_control_internal\(\) to service_role;/);
  assert.match(edgeMigration, /revoke all on function public\.set_payment_creation_enabled_internal\(boolean, text, uuid\) from public, anon, authenticated;/);
  assert.match(edgeMigration, /drop function if exists public\.get_teacher_payment_creation_control\(\);/);
  assert.match(edgeMigration, /drop function if exists public\.set_teacher_payment_creation_enabled\(boolean, text\);/);
});

test("kill switch browser management goes through JWT and MFA Edge Function", function () {
  assert.match(edgeSource, /auth\.getUser\(token\)/);
  assert.match(edgeSource, /rpc\("is_teacher_admin_mfa"\)/);
  assert.match(edgeSource, /get_payment_creation_control_internal/);
  assert.match(edgeSource, /set_payment_creation_enabled_internal/);
  assert.match(edgeSource, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(edgeSource, /SUPABASE_SECRET_KEYS/);
  assert.match(browserSource, /functions\.invoke\("manage-payment-creation-control"/);
  assert.doesNotMatch(browserSource, /\.rpc\("set_teacher_payment_creation_enabled"/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20261104022500_prevent_unauthenticated_waitlist_rewrites.sql"
);

const WAITLIST_SIGNATURE = /create or replace function public\.join_public_class_seat_waitlist\(/gi;
const IDEMPOTENT_INSERT = /on conflict\s*\(\s*class_number\s*,\s*normalized_phone\s*\)\s*do nothing\s*;/gi;

function loadMigration() {
  return fs.readFileSync(MIGRATION_PATH, "utf8");
}

function extractPublicRpcDefinitions(sql) {
  return sql
    .split(/(?=CREATE OR REPLACE FUNCTION public\.join_public_class_seat_waitlist\()/)
    .filter(part => /^CREATE OR REPLACE FUNCTION/i.test(part.trimStart()));
}

test("both waitlist RPC overloads preserve idempotency without overwriting contacts", () => {
  const sql = loadMigration();
  const overloads = extractPublicRpcDefinitions(sql);

  assert.equal([...sql.matchAll(WAITLIST_SIGNATURE)].length, 2);
  assert.equal([...sql.matchAll(IDEMPOTENT_INSERT)].length, 2);
  assert.equal(overloads.length, 2);

  for (const definition of overloads) {
    assert.match(definition, /SECURITY DEFINER/i);
    assert.match(definition, /SET search_path TO ''/i);
    assert.match(definition, /insert into private\.class_seat_waitlist/i);
    assert.match(definition, /return true;/i);
    assert.doesNotMatch(definition, /on conflict[\s\S]*?do update/i);
    assert.doesNotMatch(definition, /status\s*=\s*'waiting'/i);
    assert.doesNotMatch(definition, /applicant_name\s*=\s*excluded\./i);
    assert.doesNotMatch(definition, /whatsapp\s*=\s*excluded\./i);
  }
});

test("public waitlist hardening has no billing, RLS, MFA or grant side effects", () => {
  const sql = loadMigration();

  assert.doesNotMatch(sql, /\b(?:alter table|drop table|delete from|truncate|grant|revoke|create policy)\b/i);
  assert.doesNotMatch(sql, /(?:is_teacher_admin_mfa|\baal2\b|monthly_tuition|student_billing_settings|class_students)/i);
  assert.match(sql, /target_client_key text/);
});

test("public form keeps the four-argument RPC and separate reservation flow", () => {
  const app = fs.readFileSync(
    path.join(__dirname, "..", "escolher-turma", "app.js"),
    "utf8"
  );

  assert.match(app, /callRpc\("join_public_class_seat_waitlist"/);
  assert.match(app, /target_client_key: clientKey/);
  assert.match(app, /callRpc\("create_public_class_seat_hold"/);
});

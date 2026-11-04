const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATION = path.join(
  __dirname, "..", "supabase", "migrations",
  "20261104024500_throttle_public_class_seat_submission_attempts.sql"
);

function readFile(file) {
  return fs.readFileSync(file, "utf8");
}

function getRpcBodies(sql) {
  return sql
    .split(/(?=CREATE OR REPLACE FUNCTION public\.(?:create_public_class_seat_hold|join_public_class_seat_waitlist)\()/gi)
    .filter(part => /^CREATE OR REPLACE FUNCTION public\./.test(part.trimStart()));
}

test("one shared phone budget covers both overloads of both RPCs", () => {
  const source = readFile(MIGRATION);
  const rpcBodies = getRpcBodies(source);
  assert.equal(rpcBodies.length, 4);

  for (const definition of rpcBodies) {
    const operation = definition.includes("join_public_class_seat_waitlist")
      ? "waitlist" : "hold";
    assert.match(
      definition,
      new RegExp("perform private\\.assert_public_class_seat_attempt_budget\\(target_whatsapp, '" + operation + "'\\)")
    );
    assert.match(definition, /SECURITY DEFINER/);
    assert.match(definition, /SET search_path TO ''/);
    assert.match(definition, /return (true|jsonb_build_object)/);
    assert.equal((definition.match(/assert_public_class_seat_attempt_budget/g) || []).length, 1);
  }

  assert.match(source, /target_client_key text/);
  assert.match(source, /join_public_class_seat_waitlist\(target_class_number integer, target_name text, target_whatsapp text\)/i);
  assert.match(source, /create_public_class_seat_hold\(target_class_number integer, target_name text, target_whatsapp text\)/i);
});

test("private budget helper uses server-side atomic limits, not browser-supplied identity", () => {
  const source = readFile(MIGRATION);
  const helper = source.split("revoke all on function")[0];
  assert.match(helper, /create or replace function private\.assert_public_class_seat_attempt_budget/i);
  assert.match(helper, /security invoker/i);
  assert.match(helper, /private\.normalize_trial_phone\(target_whatsapp\)/);
  assert.match(helper, /encode\(extensions\.digest\(normalized_phone, 'sha256'\), 'hex'\)/);
  assert.match(helper, /target_operation/);
  assert.match(helper, /when 'hold' then[\s\S]*hourly_limit := 8;[\s\S]*daily_limit := 18/);
  assert.match(helper, /when 'waitlist' then[\s\S]*hourly_limit := 12;[\s\S]*daily_limit := 30/);
  assert.match(helper, /consume_api_rate_limit\([\s\S]*3600, hourly_limit/);
  assert.match(helper, /consume_api_rate_limit\([\s\S]*86400, daily_limit/);
  assert.match(source, /revoke all on function private\.assert_public_class_seat_attempt_budget\(text,text\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(helper, /target_client_key|request\.headers|x-forwarded-for|cf-connecting-ip/i);
  assert.doesNotMatch(source, /grant execute|create policy|alter table|drop table/i);
});

test("no extra access, account verification or billing changes introduced", () => {
  const source = readFile(MIGRATION);
  assert.doesNotMatch(source, /is_teacher_admin_mfa|aal2|mfa\.|monthly_tuition|student_billing_settings|auth\.users/i);
  assert.doesNotMatch(source, /update private\.class_seat_waitlist[\s\S]*set applicant_name/i);
  assert.match(source, /on conflict \(class_number, normalized_phone\) do nothing/);
  const client = readFile(path.join(__dirname, "..", "escolher-turma", "app.js"));
  assert.match(client, /callRpc\("create_public_class_seat_hold"/);
  assert.match(client, /callRpc\("join_public_class_seat_waitlist"/);
  assert.match(client, /target_client_key: clientKey/);
});

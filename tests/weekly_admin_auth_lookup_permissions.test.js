const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const migration = readFileSync(
  join(__dirname, "..", "supabase", "migrations",
    "20261021202025_secure_weekly_administrative_auth_lookup.sql"),
  "utf8",
);
const edge = readFileSync(
  join(__dirname, "..", "supabase", "functions",
    "create-administrative-student", "index.ts"),
  "utf8",
);

test("limited helper checks banned technical identity without exposing auth.users", () => {
  assert.match(migration, /private\.is_banned_administrative_identity/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /u\.email = \('student-' \|\| target_user_id::text \|\| '@administrativo\.teacherflavius\.com'\)/);
  assert.match(migration, /u\.banned_until > now\(\)/);
  assert.match(migration, /u\.deleted_at is null/);
  assert.match(migration, /revoke all on function private\.is_banned_administrative_identity\(uuid\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function private\.is_banned_administrative_identity\(uuid\)[\s\S]*?to service_role/i);
});

test("the enrollment RPC uses invoker rights and never reads auth.users directly", () => {
  const wrapper = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.create_teacher_administrative_weekly_student_internal"),
  );
  assert.match(wrapper, /private\.is_banned_administrative_identity\(target_user_id\)/);
  assert.doesNotMatch(wrapper, /from auth\.users/i);
  assert.match(wrapper, /security invoker/i);
  assert.match(migration, /revoke all on function public\.create_teacher_administrative_weekly_student_internal\([\s\S]*?from public,anon,authenticated/i);
});

test("server logs a meaningful Supabase RPC error without granting new portal access", () => {
  assert.match(edge, /typeof error === "object" && "message" in error/);
  assert.match(edge, /ban_duration: ACCESS_BAN_DURATION/);
  assert.match(edge, /authenticated\.rpc\("is_teacher_admin"\)/);
});

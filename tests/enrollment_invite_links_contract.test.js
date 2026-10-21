const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const sql = read("supabase/migrations/20261021165704_enrollment_invite_links.sql");
const onboarding = read("complete-cadastro.html");
const login = read("login.html");
const admin = read("links-de-matricula/index.html");
const adminApp = read("links-de-matricula/app.js");

test("two default shareable plans retain server-defined commercial terms", function () {
  assert.match(sql, /'grupo-semanal-50',[\s\S]*?50, 4, 'group'/);
  assert.match(sql, /'individual-semanal-250',[\s\S]*?250, 4, 'individual'/);
  assert.match(sql, /private\.enrollment_invite_links/);
  assert.match(sql, /gen_random_bytes\(24\)/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table private\.enrollment_invite_links from public, anon, authenticated/i);
});

test("invitation links enforce Google authentication, teacher-only management, and rate limits", function () {
  assert.match(sql, /public\.is_teacher_admin\(\)/);
  assert.match(sql, /provider_name <> 'google'/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /link\.token = token_value and link\.active = true/);
  assert.match(sql, /failed_attempts = case when attempts >= 5/);
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /revoke all on function public\.manage_enrollment_invite_links/);
  assert.match(sql, /revoke all on function public\.authorize_my_enrollment_link\(text\) from public, anon/);
});

test("server binds group or individual modality without permitting a mismatched client choice", function () {
  assert.match(sql, /authorized_class_mode = selected_link\.class_mode/);
  assert.match(sql, /server_mode <> normalized_mode/);
  assert.match(sql, /enforce_link_enrollment_class_mode/);
  assert.match(sql, /new\.class_type is distinct from/);
  assert.match(onboarding, /get_my_authorized_enrollment_plan/);
  assert.match(onboarding, /classMode\.disabled = state\.requiresClassMode && !!authorizedInviteMode/);
  assert.match(onboarding, /set_my_enrollment_class_mode/);
  assert.match(onboarding, /rpc\("set_my_enrollment_billing_terms"\)/);
  assert.match(onboarding, /state\.mode === NEW_ENROLLMENT_MODE[\s\S]*getPostEnrollmentPath/);
});

test("Google OAuth preserves the exact enrollment invitation path", function () {
  assert.match(login, /destination\.startsWith\("\/complete-cadastro\/\?"\)/);
  assert.match(login, /window\.location\.replace\(destination\)/);
  assert.match(onboarding, /applyInvitation\(state\)/);
  assert.match(onboarding, /authorize_my_enrollment_link/);
  assert.match(onboarding, /Auth\.requireAuth\(\{ skipProfileCheck: true \}\)/);
});

test("teacher administration can create, copy, deactivate and rotate links", function () {
  assert.match(admin, /id="newLinkForm"/);
  assert.match(admin, /id="linksList"/);
  assert.match(adminApp, /Auth\.isTeacherAdmin\(\)/);
  assert.match(adminApp, /request\("create"/);
  assert.match(adminApp, /request\("set_active"/);
  assert.match(adminApp, /request\("rotate"/);
  assert.match(adminApp, /navigator\.clipboard\.writeText/);
  assert.match(read("professor.html"), /href="\/links-de-matricula\/"/);
  assert.doesNotMatch(sql, /update public\.student_billing_settings[\s\S]*set monthly_fee/i);
});

test("shareable invitation token validation is strict and does not expose price arguments", function () {
  const context = { URLSearchParams, window: {} };
  vm.runInNewContext(read("enrollment_invite_client.js"), context);
  const client = context.window.EnrollmentInviteClient;
  const token = "a".repeat(48);
  assert.equal(client.readInviteToken("?convite=" + token), token);
  assert.equal(client.readInviteToken("?convite=../../bad"), null);
  assert.equal(client.buildInviteUrl(token),
    "https://teacherflavius.com/complete-cadastro/?convite=" + token);
  assert.throws(() => client.buildInviteUrl("invalid"), /inválido/);
  assert.doesNotMatch(onboarding, /target_monthly_fee:/);
});

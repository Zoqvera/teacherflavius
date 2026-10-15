const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const migration = read("supabase/migrations/20261015041000_retry_transactional_emails_safely.sql");
const enrollment = read("supabase/functions/notify-new-enrollment/index.ts");
const makeup = read("supabase/functions/notify-makeup-booking/index.ts");
const regular = read("supabase/functions/notify-regular-lesson-cancellation/index.ts");

test("bounded retry covers three private outboxes with a stable 10-minute schedule", () => {
  for (const name of [
    "enrollment_email_notifications",
    "makeup_class_email_notifications",
    "regular_lesson_cancellation_email_notifications",
  ]) {
    assert.match(migration, new RegExp("from public\\." + name));
  }
  assert.match(migration, /status in \('pending', 'failed'\)/);
  assert.equal((migration.match(/attempts < 3/g) || []).length, 3);
  assert.equal((migration.match(/created_at between now\(\) - interval '18 hours' and now\(\) - interval '5 minutes'/g) || []).length, 3);
  assert.equal((migration.match(/last_attempt_at is null or last_attempt_at <= now\(\) - interval '10 minutes'/g) || []).length, 3);
  assert.equal((migration.match(/limit 15/g) || []).length, 3);
  assert.match(migration, /'transactional-email-retry-10m'/);
  assert.match(migration, /'\*\/10 \* \* \* \*'/);
});

test("retry uses Vault-stored webhook secret, private function and no exposed data API access", () => {
  assert.match(migration, /create or replace function private\.retry_transactional_email_notifications\(\)/);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /teacherflavius_notification_webhook_secret/);
  assert.match(migration, /revoke all on function private\.retry_transactional_email_notifications\(\)/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy|grant .* to authenticated|grant .* to anon/i);
  assert.doesNotMatch(migration, /raw_user_meta_data|user_metadata/);
});

test("retry sends existing minimal webhook payloads to the correct signed edge endpoints", () => {
  const endpoints = [
    "notify-new-enrollment",
    "notify-makeup-booking",
    "notify-regular-lesson-cancellation",
  ];
  for (const endpoint of endpoints) assert.ok(migration.includes("/functions/v1/" + endpoint));
  assert.equal((migration.match(/'x-webhook-secret', webhook_secret/g) || []).length, 3);
  assert.match(migration, /'student_id', enrollment_row\.student_id/);
  assert.match(migration, /'booking_id', makeup_row\.booking_id/);
  assert.match(migration, /'record', pg_catalog\.jsonb_build_object\('id', regular_row\.id\)/);
  assert.doesNotMatch(migration, /email\s*\|\||cpf|whatsapp|resendApiKey/i);
});

test("every sender atomically claims only the matching status and prior attempt count", () => {
  for (const sender of [enrollment, makeup, regular]) {
    assert.match(sender, /\.eq\("status", (?:notification|notice)\.status\)/);
    assert.match(sender, /\.eq\("attempts", (?:notification|notice)\.attempts\)/);
    assert.match(sender, /\.select\("id"\)\s+\.maybeSingle\(\)/);
    assert.match(sender, /if \(!claimed\) return jsonResponse\(\{ ok: true, skipped: "already_claimed" \}\)/);
    assert.match(sender, /Date\.now\(\) - new Date\((?:notification|notice)\.created_at\)\.getTime\(\) > 18/);
    assert.match(sender, /Manual reconciliation required after idempotency window/);
  }
});

test("makeup calendar attachment remains identical when retries reuse Resend idempotency key", () => {
  assert.match(makeup, /function makeIcsAttachment\(/);
  assert.match(makeup, /createdAt: string,/);
  assert.match(makeup, /DTSTAMP:\$\{formatCalendarInstant\(createdAt\)\}/);
  assert.match(makeup, /notification\.created_at,/);
  assert.doesNotMatch(makeup, /DTSTAMP:\$\{formatCalendarInstant\(new Date\(\)\.toISOString\(\)\)\}/);
  assert.match(makeup, /"Idempotency-Key": `makeup-\$\{notificationType\}-\$\{notification\.id\}`/);
});

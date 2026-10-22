const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261022151706_daily_lesson_credit_integrity_email_alerts.sql"),
  "utf8",
);
const notifier = fs.readFileSync(
  path.join(root, "supabase/functions/notify-lesson-credit-integrity/index.ts"),
  "utf8",
);
const baseline = fs.readFileSync(
  path.join(root, "supabase/baseline/30_platform_config.sql"),
  "utf8",
);

test("daily audit runs at 23h Sao Paulo and retries pending emails", () => {
  assert.match(migration, /daily-lesson-credit-integrity-23h','0 2 \* \* \*'/);
  assert.match(migration, /retry-lesson-credit-integrity-email-15m','\*\/15 \* \* \* \*'/);
  assert.match(baseline, /daily-lesson-credit-integrity-23h/);
  assert.match(baseline, /retry-lesson-credit-integrity-email-15m/);
});

test("one daily report is logged without emailing successful audits", () => {
  assert.match(migration, /audit_date date not null unique/i);
  assert.match(migration, /on conflict\(audit_date\) do nothing/i);
  assert.match(migration, /case when total=0 then 'not_required' else 'pending' end/i);
  assert.match(migration, /if run_id is not null and total>0 then/i);
  assert.match(migration, /private\.audit_paid_lesson_schedule_integrity\(\)/i);
});

test("student integrity data cannot be retrieved through browser roles", () => {
  assert.match(migration, /alter table private\.lesson_credit_integrity_runs enable row level security/i);
  assert.match(migration, /revoke all on table private\.lesson_credit_integrity_runs from public,anon,authenticated/i);
  assert.match(migration, /revoke all on function public\.claim_lesson_credit_integrity_email_internal\(uuid\)/i);
  assert.match(migration, /grant execute on function public\.claim_lesson_credit_integrity_email_internal\(uuid\) to service_role/i);
  assert.match(notifier, /isAuthorized\(request\.headers\.get\("x-webhook-secret"\)/);
});

test("retry flow is bounded, idempotent and does not update student lessons", () => {
  assert.match(migration, /attempts<3 and dispatch_count<10/i);
  assert.match(migration, /interval '18 hours'/i);
  assert.match(migration, /last_attempt_at < now\(\)-interval '15 minutes'/i);
  assert.match(notifier, /"Idempotency-Key": `lesson-integrity-\$\{runId\}`/);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from)\s+private\.lesson_credits\b/i);
});

test("email goes only to administrative address with fixed subject", () => {
  assert.match(notifier, /const ADMIN_EMAIL = "contato@teacherflavius.com"/);
  assert.match(notifier, /const SUBJECT = "Alerta de integridade — TeacherFlavius"/);
  assert.match(notifier, /to: \[ADMIN_EMAIL\]/);
  assert.match(notifier, /issue\.student_name/);
  assert.match(notifier, /issue\.credit_id/);
  assert.match(notifier, /status: "sent" \| "failed"/);
});

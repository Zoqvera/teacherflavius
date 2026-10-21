const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(
  root, "supabase/migrations/20261016162500_justify_attended_cancelled_lesson_revocations.sql"
), "utf8");
const adminScript = fs.readFileSync(path.join(root, "lesson_credit_admin.js"), "utf8");

test("revocation requires confirmed attendance and the original cancellation", () => {
  assert.match(migration, /justified\.reason_code = 'attended_original_class'/);
  assert.match(migration, /student_regular_lesson_cancellations/);
  assert.match(migration, /attendance\.attendance_status = 'Compareceu'/);
  assert.match(migration, /occurrence\.attendance_status = 'present'/);
  assert.match(migration, /then 'revoked_attended_original_class'/);
  assert.match(migration, /when credit\.revoked_at is not null then 'revoked_review'/);
  assert.match(migration, /booking\.status = 'confirmed'/);
  assert.match(migration, /revoked_unpaid/);
});

test("tuition resynchronization preserves justified revocations", () => {
  assert.equal((migration.match(
    /from private\.lesson_credit_revocation_justifications reason/g
  ) || []).length, 2);
  assert.match(migration, /then credit\.revoked_at/);
  assert.match(migration, /then private\.lesson_credits\.revoked_at/);
  assert.doesNotMatch(migration, /delete\s+from\s+private\.student_regular_lesson_cancellations/i);
});

test("only the teacher can justify existing revocations", () => {
  assert.match(migration, /not coalesce\(public\.is_teacher_admin\(\), false\)/);
  assert.match(migration, /target_credit\.revoked_at is null/);
  assert.match(migration, /target_credit\.makeup_booking_id is not null/);
  assert.match(migration, /on conflict \(credit_id\) do nothing/);
  assert.match(migration,
    /revoke all on private\.lesson_credit_revocation_justifications from public, anon, authenticated/);
  assert.match(migration,
    /grant execute on function public\.justify_teacher_attended_cancelled_lesson\(uuid\)\s+to authenticated/);
});

test("teacher audit safely displays the documented justification", async () => {
  const elements = Object.fromEntries(
    ["lessonCreditAudit", "lessonCreditAuditContent", "refreshCreditAuditButton"]
      .map((id) => [id, {
        hidden: true,
        disabled: false,
        textContent: "",
        innerHTML: "",
        addEventListener() {}
      }])
  );
  const Auth = {
    isConfigured: () => true,
    getSession: async () => ({ user: { id: "teacher" } }),
    getClient: () => ({
      rpc: async (name) => name === "is_teacher_admin"
        ? { data: true }
        : { data: {
          summary: {
            revoked_total: 1, revoked_attended_original_class: 1,
            revoked_review: 0, revoked_confirmed_booking: 0,
            active_unpaid: 0, active_excess: 0
          },
          credits: [{
            student_name: "Example student",
            reference_month: "2026-10-01",
            credit_number: 2,
            original_status: "forfeited",
            revoked_at: "2026-10-15T19:15:08Z",
            classification: "revoked_attended_original_class",
            revocation_justification: "<svg onload=alert(1)>"
          }]
        }}
    })
  };

  vm.runInNewContext(adminScript, {
    document: { getElementById: (id) => elements[id] },
    window: { Auth },
    Auth, Date, Intl, Number, String, Boolean, Object, Array, Error
  });
  for (let retry = 0; retry < 20 && !elements.lessonCreditAuditContent.innerHTML; retry++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const html = elements.lessonCreditAuditContent.innerHTML;
  assert.match(html, /Revogação justificada: compareceu à aula originalmente cancelada/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /Revogações justificadas: presença na aula original/);
});

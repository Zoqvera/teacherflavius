const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(
  root, "supabase/migrations/20261012170503_lesson_credit_audit_and_revocation_status.sql"
), "utf8");
const adminScript = fs.readFileSync(path.join(root, "lesson_credit_admin.js"), "utf8");
const adminPage = fs.readFileSync(path.join(root, "reposicoes_admin.html"), "utf8");

test("revoked credits retain historical status and are presented as revoked", () => {
  assert.match(migration, /when credit\.revoked_at is not null then 'Revogado'/i);
  assert.match(migration, /'revoked_unpaid'/i);
  assert.match(migration, /'revoked_excess'/i);
  assert.match(migration, /'revoked_review'/i);
  assert.doesNotMatch(migration, /update\s+private\.lesson_credits/i);
  assert.doesNotMatch(migration, /delete\s+from\s+private\.lesson_credits/i);
});

test("credit audit recognizes missing payment, plan changes, and active anomalies", () => {
  assert.match(migration, /tuition\.payment_date is null and not coalesce\(tuition\.is_exempt, false\)/i);
  assert.match(migration, /credit\.credit_number > billing\.classes_per_month/i);
  assert.match(migration, /booking\.status = 'confirmed'/i);
  for (const code of [
    "data_quality_active_credit_unpaid_tuition",
    "data_quality_revoked_credit_confirmed_booking",
    "data_quality_credit_revocation_requires_review",
    "data_quality_legacy_credit_plan_review"
  ]) {
    assert.ok(migration.includes(code), `Missing quality alert ${code}`);
  }
});

test("audit RPC is teacher-only and underlying snapshot is private", () => {
  assert.match(migration, /if \(select auth\.uid\(\)\) is null or not public\.is_teacher_admin\(\)/i);
  assert.match(migration, /revoke all on function private\.lesson_credit_audit_snapshot\(\)/i);
  assert.match(migration, /revoke all on function public\.get_teacher_lesson_credit_audit\(\)/i);
  assert.match(migration, /grant execute on function public\.get_teacher_lesson_credit_audit\(\)\s+to authenticated, service_role/i);
});

test("administrative page loads credit audit without changing indexed metadata", () => {
  assert.match(adminPage, /id="lessonCreditAudit"/);
  assert.match(adminPage, /lesson_credit_admin\.js/);
  assert.match(adminPage, /lesson_credit_admin\.css/);
  assert.match(adminScript, /get_teacher_lesson_credit_audit/);
  assert.match(adminScript, /revoked \? "Revogado" : credit\.effective_status/);
});

test("teacher audit escapes student names and effective states in rendered markup", async () => {
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
        : {
            data: {
              details_limit: 100,
              summary: {
                revoked_total: 1, revoked_unpaid: 1, revoked_excess: 0,
                revoked_review: 0, active_excess: 0,
                active_unpaid: 0, revoked_confirmed_booking: 0
              },
              credits: [{
                student_name: "<img src=x onerror=alert(1)>",
                reference_month: "2026-10-01",
                credit_number: 1,
                original_status: "available",
                effective_status: "Revogado",
                revoked_at: "2026-10-09T18:39:04Z",
                classification: "revoked_unpaid"
              }]
            }
          }
    })
  };

  vm.runInNewContext(adminScript, {
    document: { getElementById: (id) => elements[id] },
    window: { Auth },
    Auth,
    Date,
    Intl,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Error
  });

  for (let attempt = 0; attempt < 20 &&
    !elements.lessonCreditAuditContent.innerHTML; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const html = elements.lessonCreditAuditContent.innerHTML;
  assert.equal(elements.lessonCreditAudit.hidden, false);
  assert.match(html, /Revogado/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Revogação prevista: mensalidade não quitada/);
});

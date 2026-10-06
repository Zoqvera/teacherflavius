const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const firstTuitionHelper = read(
  "supabase/migrations/20261004081243_align_first_tuition_with_lesson_start_month.sql"
);
const studentDueDateFlow = read(
  "supabase/migrations/20261005144218_limit_first_tuition_to_next_day.sql"
);
const unifiedAdminFlow = read(
  "supabase/migrations/20261006022000_unify_first_tuition_due_rule.sql"
);
const enrollmentActivation = read(
  "supabase/migrations/20261004074423_student_sets_enrollment_commercial_terms.sql"
);

test("first tuition creation is idempotent and preserves settled financial history", function () {
  assert.match(
    firstTuitionHelper,
    /on conflict \(student_id, reference_month\) do update/i
  );
  assert.match(
    firstTuitionHelper,
    /where public\.monthly_tuition\.payment_date is null\s+and not public\.monthly_tuition\.is_exempt/i
  );
  assert.match(
    firstTuitionHelper,
    /if tuition_id is null[\s\S]*from public\.monthly_tuition tuition[\s\S]*tuition\.student_id = target_student_id/i
  );
});

test("student due-date selection creates the first tuition when billing terms already exist", function () {
  assert.match(
    studentDueDateFlow,
    /update public\.student_billing_settings[\s\S]*billing_start_month = system_start_month/i
  );
  assert.match(
    studentDueDateFlow,
    /first_tuition_id := private\.ensure_first_tuition_for_student\(\s*caller_id,\s*chosen_first_due_date\s*\)/i
  );
  assert.match(
    studentDueDateFlow,
    /'first_tuition_id', first_tuition_id/i
  );
});

test("teacher billing save creates the first tuition when the due date already exists", function () {
  assert.match(
    unifiedAdminFlow,
    /insert into public\.student_billing_settings[\s\S]*on conflict \(student_id\) do update/i
  );
  assert.match(
    unifiedAdminFlow,
    /if coalesce\(target_active, true\) then\s+first_tuition_id := private\.ensure_first_tuition_for_student\(\s*target_student_id,\s*chosen_first_due_date\s*\)/i
  );
  assert.match(
    unifiedAdminFlow,
    /'first_tuition_id', first_tuition_id/i
  );
});

test("enrollment completion also ensures the first tuition without opening the admin area", function () {
  assert.match(
    enrollmentActivation,
    /create or replace function private\.ensure_first_tuition_after_profile_enrollment\(\)/i
  );
  assert.match(
    enrollmentActivation,
    /coalesce\(new\.enrolled, false\)[\s\S]*not coalesce\(old\.enrolled, false\)[\s\S]*new\.tuition_first_due_date is not null/i
  );
  assert.match(
    enrollmentActivation,
    /perform private\.ensure_first_tuition_for_student\(\s*new\.id,\s*new\.tuition_first_due_date\s*\)/i
  );
  assert.match(
    enrollmentActivation,
    /create trigger ensure_first_tuition_after_profile_enrollment[\s\S]*after update of enrolled on public\.profiles/i
  );
});

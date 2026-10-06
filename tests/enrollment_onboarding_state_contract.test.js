const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const stateService = read("enrollment_onboarding_state.js");
const tuitionDueDay = read("student_tuition_due_day.js");
const migration = read(
  "supabase/migrations/20261006114559_backend_driven_enrollment_onboarding_state.sql"
);
const baseline = read(
  "supabase/baseline/270_backend_driven_enrollment_onboarding_state.sql"
);

test("backend classifies incomplete existing students separately from new enrollments", function () {
  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /when coalesce\(profile_row\.enrolled, false\) then 'existing_student_profile_completion'/i
    );
    assert.match(sql, /else 'new_enrollment'/i);
    assert.match(sql, /'requires_access_code', flow_mode = 'new_enrollment'/i);
    assert.match(sql, /'requires_class_mode', flow_mode = 'new_enrollment'/i);
    assert.match(sql, /'requires_tuition_due_date', flow_mode = 'new_enrollment'/i);
    assert.match(sql, /'requires_commercial_setup', flow_mode = 'new_enrollment'/i);
    assert.match(
      sql,
      /flow_mode = 'existing_student_profile_completion'[\s\S]*or \(flow_mode = 'new_enrollment' and access_authorized\)/i
    );
    assert.match(sql, /security invoker/i);
  }
});

test("browser reads enrollment behavior only from the backend state RPC", function () {
  assert.match(stateService, /rpc\("get_my_enrollment_onboarding_state"\)/);
  assert.match(page, /EnrollmentOnboardingState/);
  assert.match(page, /state\.requiresAccessCode/);
  assert.match(page, /state\.requiresClassMode/);
  assert.match(page, /state\.requiresTuitionDueDate/);
  assert.match(page, /state\.requiresCommercialSetup/);
  assert.doesNotMatch(page, /hasEnrollmentAccess\(\)/);
});

test("existing students bypass commercial enrollment operations", function () {
  assert.match(page, /classModeField\.hidden = !state\.requiresClassMode/);
  assert.match(
    page,
    /if \(state\.requiresClassMode\)[\s\S]*set_my_enrollment_class_mode/
  );
  assert.match(
    page,
    /if \([\s\S]*state\.requiresTuitionDueDate[\s\S]*StudentTuitionDueDay\.saveSelection/
  );
  assert.match(
    page,
    /if \(state\.requiresCommercialSetup\)[\s\S]*set_my_enrollment_billing_terms/
  );
  assert.match(
    page,
    /state\.mode === NEW_ENROLLMENT_MODE[\s\S]*getPostEnrollmentPath\(\)[\s\S]*getNextPath\(\)/
  );
});

test("tuition module does not mount or save a due date outside new enrollment", function () {
  assert.match(
    tuitionDueDay,
    /state\.enabled = onboardingState\.requiresTuitionDueDate === true/
  );
  assert.match(tuitionDueDay, /if \(!state\.enabled\) return null/);
  assert.match(
    tuitionDueDay,
    /if \(!state\.enabled\)[\s\S]*existingSection\.remove\(\)[\s\S]*return false/
  );
});

test("existing profile completion copy explicitly preserves commercial terms", function () {
  assert.match(page, /Seu plano e suas condições financeiras já registradas serão preservados/);
  assert.match(
    page,
    /Mensalidade, quantidade de aulas, tipo de aula e vencimento já registrados não serão alterados/
  );
  assert.match(page, /SALVAR DADOS E ACESSAR/);
});

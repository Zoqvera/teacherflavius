const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repository = path.resolve(__dirname, "..");
const load = (name) => fs.readFileSync(path.join(repository, name), "utf8");
const policy = load("supabase/migrations/20261009201655_restrict_individual_replacements_to_individual_with_cancellation_credit.sql");
const compatibility = load("supabase/migrations/20261009201830_preserve_group_replacement_enrollment_access.sql");

function sqlFunction(source, name) {
  const expression = new RegExp(
    "create or replace function (?:public|private)\\." + name + "\\([\\s\\S]*?\\$function\\$;",
    "i"
  );
  const match = source.match(expression);
  assert.ok(match, "Missing SQL function: " + name);
  return match[0];
}

test("an active individual's replacement modality comes from their current enrollment", () => {
  const helper = sqlFunction(compatibility, "student_replacement_target_type");
  assert.match(helper, /profile\.enrolled = true/);
  assert.match(helper, /coalesce\(profile\.archived, false\) = false/);
  assert.match(helper, /when 'INDIVIDUAL' then 'individual'/);
  assert.match(helper, /when 'QUINTETO' then 'quintet'/);
  assert.match(helper, /regular_class\.class_type = 'individual'/);
  assert.match(helper, /upper\(btrim\(profile\.class_type\)\) = 'QUINTETO'/);
});

test("individual cancellation credits must have a contract origin and actual cancellation", () => {
  const creditGuard = sqlFunction(policy, "is_student_replacement_credit_eligible");
  assert.match(creditGuard, /private\.is_replacement_credit_eligible/);
  assert.match(creditGuard, /credit_origin = 'contract' and cancelled_at is not null/);
  assert.match(creditGuard, /student_replacement_target_type\(target_student_id\) = 'quintet'/);
});

test("the replacement listing and booking both enforce the student's class category", () => {
  const options = sqlFunction(policy, "get_my_replacement_options");
  const book = sqlFunction(policy, "book_my_lesson_replacement");
  const overview = sqlFunction(policy, "get_my_lessons_overview");

  for (const operation of [options, book]) {
    assert.match(operation, /class\.class_type = private\.student_replacement_target_type\(caller_id\)/);
    assert.match(operation, /private\.is_student_replacement_credit_eligible/);
    assert.match(operation, /private\.is_replacement_weekday_eligible/);
  }
  assert.match(overview, /private\.is_student_replacement_credit_eligible/);
  assert.match(book, /credit_row\.status <> 'available'/);
  assert.match(book, /status = 'used'/);
});

test("one-to-one lessons can accept an empty or canceled seat while group rules stay unchanged", () => {
  const options = sqlFunction(policy, "get_my_replacement_options");
  const book = sqlFunction(policy, "book_my_lesson_replacement");
  assert.match(options, /capacity_limit[\s\S]*regular_students - snapshot\.cancelled_regular_students \+ snapshot\.replacement_students/);
  assert.match(options, /private\.student_replacement_target_type\(caller_id\) = 'individual'[\s\S]*private\.is_replacement_occurrence_eligible/);
  assert.match(book, /class_row\.class_type <> 'individual'[\s\S]*private\.is_replacement_occurrence_eligible/);
  assert.match(book, /if available_spots <= 0 then/);
  assert.match(book, /for update of credit/);
  assert.match(book, /for update;/);
});

test("creditless legacy booking endpoints remain inaccessible to students", () => {
  assert.match(policy, /revoke execute on function public\.book_makeup_class\(uuid\) from public,anon,authenticated/i);
  assert.match(policy, /revoke execute on function public\.get_available_makeup_slots\(\) from public,anon,authenticated/i);
  assert.match(policy, /revoke all on function private\.student_replacement_target_type\(uuid\)/i);
});

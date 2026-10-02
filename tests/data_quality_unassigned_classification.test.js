const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20261002030000_make_unassigned_classification_informational.sql"
  ),
  "utf8"
);

test("classified students awaiting placement do not degrade data quality health", function () {
  assert.match(
    migration,
    /typed_student_without_active_class_info/
  );
  assert.match(
    migration,
    /Classified students without a class are valid while awaiting placement/
  );
  assert.match(
    migration,
    /Expected typed-student-without-active-class warning was not found/
  );
});

test("migration preserves the count as an informational metric", function () {
  assert.match(
    migration,
    /'typed_student_without_active_class_info',typed_student_without_active_class/
  );
  assert.doesNotMatch(
    migration,
    /new_metric_fragment[\s\S]*data_quality_typed_student_without_active_class/
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const entry = read("area-do-estudante/index.html");
const dashboard = read("area_do_estudante.html");
const invitation = read("student_review_invitation.js");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");
const baseline = read("supabase/baseline/395_student_review_invitation_funnel.sql");
const migration = read("supabase/migrations/20261015161503_track_student_review_invitation_funnel.sql");
const fingerprint = JSON.parse(read("supabase/baseline/schema-fingerprint.json"));
const baselineReadme = read("supabase/baseline/README.md");

test("PWA entry fetches the current dashboard and uncached invitation JavaScript", () => {
  assert.ok(entry.includes('sourcePage + "?v='));
  assert.match(entry, /cache: 'no-store'/);
  assert.match(dashboard, /\/student_review_invitation\.js\?v=20261015-invitation-retry-1/);
  assert.match(dashboard, /studentReviewInvitation/);
  assert.match(invitation, /record_my_student_review_invitation/);
  assert.doesNotMatch(dashboard, /\/student_review_invitation\.js\?v=20261015-1"/);
});

test("reconstruction runs the exact audited production SQL after other overlays", () => {
  assert.equal(baseline, migration);
  const preceding = workflow.indexOf("supabase/baseline/390_expose_study_button_marker.sql");
  const funnel = workflow.indexOf("supabase/baseline/395_student_review_invitation_funnel.sql");
  const loop = workflow.indexOf("\n          do", funnel);
  assert.ok(preceding >= 0 && funnel > preceding && loop > funnel);
  assert.match(workflow, /supabase\/baseline\/395_student_review_invitation_funnel\.sql/);
  assert.match(baselineReadme, /automated reconstruction applies this overlay/i);
});

test("reconstruction fingerprint counts public RPCs while private tables use separate security tests", () => {
  assert.equal(fingerprint.captured_from_migration_version, "20261015161503");
  assert.equal(fingerprint.tables, 52);
  assert.equal(fingerprint.constraints, 266);
  assert.equal(fingerprint.public_functions, 192);
  assert.equal(fingerprint.non_constraint_indexes, 116);
  assert.equal(fingerprint.rls_policies, 95);
});

test("private metrics have no direct browser grants and RPCs enforce authorization", () => {
  assert.match(baseline, /revoke all on table private\.student_review_invitation_metrics from public, anon, authenticated/);
  assert.match(baseline, /student_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(baseline, /caller_id uuid := auth\.uid\(\)/);
  assert.match(baseline, /public\.is_teacher_admin\(\)/);
  assert.match(baseline, /revoke all on function public\.get_teacher_student_review_invitation_metrics\(\) from public, anon/);
  assert.match(baseline, /revoke all on function public\.record_my_student_review_invitation\(text\) from public, anon/);
});

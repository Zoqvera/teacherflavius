const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261015161503_track_student_review_invitation_funnel.sql"
);
const overlay = read("supabase/baseline/395_student_review_invitation_funnel.sql");
const invitation = read("student_review_invitation.js");
const teacherPage = read("avaliacoes-dos-alunos/index.html");
const teacherApp = read("avaliacoes-dos-alunos/app.js");
const teacherStyle = read("avaliacoes-dos-alunos/style.css");

test("migration is reproducible from the private disaster-recovery overlay", () => {
  assert.equal(migration, overlay);
  assert.match(migration, /private\.student_review_invitation_metrics/);
  assert.match(migration, /student_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /first_shown_at timestamptz/);
  assert.match(migration, /first_clicked_at timestamptz/);
  assert.match(migration, /first_dismissed_at timestamptz/);
  assert.doesNotMatch(migration, /ip_address|user_agent|student_name/i);
});

test("student events derive identity from auth.uid and enforce enrollment and age", () => {
  assert.match(migration, /caller_id uuid := auth\.uid\(\)/);
  assert.match(migration, /p\.id = caller_id/);
  assert.match(migration, /p\.enrolled is true/);
  assert.match(migration, /coalesce\(p\.archived, false\) is false/);
  assert.match(migration, /interval '2 months'/);
  assert.match(migration, /America\/Sao_Paulo/);
  assert.match(migration, /normalized_action not in \('shown', 'clicked', 'dismissed'\)/);
  assert.match(migration, /on conflict \(student_id\) do update/);
  assert.match(migration, /coalesce\(metrics\.first_shown_at, excluded\.first_shown_at\)/);
  assert.doesNotMatch(migration, /target_student_id/);
});

test("events remain private; summary is restricted to teacher and returns aggregates", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table private\.student_review_invitation_metrics from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.record_my_student_review_invitation\(text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.record_my_student_review_invitation\(text\) to authenticated, service_role/);
  assert.match(migration, /if not coalesce\(public\.is_teacher_admin\(\), false\) then/);
  assert.match(migration, /revoke all on function public\.get_teacher_student_review_invitation_metrics\(\) from public, anon/);
  assert.match(migration, /'reviewed_after_invitation'/);
  assert.match(migration, /r\.submitted_at >= m\.first_shown_at/);
  assert.doesNotMatch(migration, /'student_id',/);
});

test("optional invitation logs actions and preserves navigation and dismissal", () => {
  assert.match(invitation, /rpc\("record_my_student_review_invitation"/);
  for (const action of ["shown", "clicked", "dismissed"]) {
    assert.match(invitation, new RegExp('recordInvitationEvent\\(client, "' + action + '"\\)'));
  }
  assert.match(invitation, /Promise\.race/);
  assert.match(invitation, /root\.location\.assign\(reviewLink\.href\)/);
  assert.match(invitation, /dialog\.showModal\(\)/);
});

test("teacher page shows aggregates only and remains non-indexable", () => {
  for (const id of [
    "reviewFunnelEligible", "reviewFunnelReviewed", "reviewFunnelShown",
    "reviewFunnelClicked", "reviewFunnelDismissed", "reviewFunnelConverted"
  ]) assert.match(teacherPage, new RegExp('id="' + id + '"'));
  assert.match(teacherPage, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(teacherApp, /rpc\(\s*"get_teacher_student_review_invitation_metrics"/);
  assert.match(teacherApp, /Promise\.all\(\[loadReviews\(\), loadInvitationMetrics\(\)\]\)/);
  assert.match(teacherStyle, /review-funnel-grid/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { buildAcademicChangeTransaction } = require("../agents/academic_secretary_transaction_plan");
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

function fixture(action, overrides = {}) {
  const request = {
    action, studentId: STUDENT_ID, classNumber: 25,
    ...(action === "new_link"
      ? { source: "instagram", firstLessonDate: "2026-11-05" }
      : { fromClassNumber: 14 }),
    ...(overrides.request || {})
  };
  const plan = {
    action, studentId: STUDENT_ID, status: "ready_for_review", readOnly: true,
    requiresAtomicExecution: true, blockers: [], missingFields: [],
    canonicalSource: "instagram",
    snapshot: { archived: false, classNumbers: [14] },
    ...(overrides.plan || {})
  };
  return { plan, request };
}

test("new link produces an immutable transaction request with declared source and date", () => {
  const { plan, request } = fixture("new_link");
  const built = buildAcademicChangeTransaction(plan, request);
  assert.equal(built.rpcName, "execute_teacher_academic_change");
  assert.equal(built.executed, false);
  assert.equal(built.requiresTeacherConfirmation, true);
  assert.deepEqual(built.arguments, {
    target_action: "new_link",
    target_student_id: STUDENT_ID,
    target_class_number: 25,
    expected_class_numbers: [14],
    target_from_class_number: null,
    target_first_lesson_date: "2026-11-05",
    target_source: "instagram",
    target_source_detail: null
  });
  assert.equal(Object.isFrozen(built), true);
  assert.equal(Object.isFrozen(built.arguments), true);
  assert.equal(Object.isFrozen(built.arguments.expected_class_numbers), true);
});

test("transfer preserves the one source link and passes no acquisition or first-date values", () => {
  const { plan, request } = fixture("transfer");
  const result = buildAcademicChangeTransaction(plan, request);
  assert.equal(result.arguments.target_from_class_number, 14);
  assert.equal(result.arguments.target_source, null);
  assert.equal(result.arguments.target_source_detail, null);
  assert.equal(result.arguments.target_first_lesson_date, null);
});

test("other source requires an explicit detail", () => {
  const { plan, request } = fixture("new_link", {
    plan: { canonicalSource: "other" },
    request: { source: "other", sourceDetail: "Matrícula por evento" }
  });
  assert.equal(buildAcademicChangeTransaction(plan, request).arguments.target_source_detail,
    "Matrícula por evento");
  awaitFalse();
  function awaitFalse() {
    const bad = fixture("new_link", { plan: { canonicalSource: "other" } });
    assert.throws(() => buildAcademicChangeTransaction(bad.plan, bad.request), /Detalhe/);
  }
});

test("rejected or incomplete plans never prepare a transactional write", () => {
  const invalid = [
    { plan: { status: "blocked" } },
    { plan: { status: "needs_input" } },
    { plan: { readOnly: false } },
    { plan: { requiresAtomicExecution: false } },
    { plan: { snapshot: { archived: true, classNumbers: [] } } },
    { plan: { snapshot: { archived: false, classNumbers: [14, 14] } } },
    { plan: { snapshot: { archived: false, classNumbers: [14, 18] } } },
    { request: { studentId: "not-a-uuid" } },
    { request: { classNumber: 14 } },
    { request: { firstLessonDate: "" } }
  ];
  for (const change of invalid) {
    const { plan, request } = fixture("new_link", change);
    assert.throws(() => buildAcademicChangeTransaction(plan, request));
  }
});

test("transfer cannot sneak in source or first-lesson fields", () => {
  for (const field of [
    { source: "google" },
    { sourceDetail: "LinkedIn" },
    { firstLessonDate: "2026-11-05" },
    { fromClassNumber: 999 }
  ]) {
    const { plan, request } = fixture("transfer", { request: field });
    assert.throws(() => buildAcademicChangeTransaction(plan, request));
  }
});

test("SQL transaction proposal serializes membership, validates live seats and preserves paid credits", () => {
  const root = path.join(__dirname, "..");
  const sql = fs.readFileSync(
    path.join(root, "docs/agents/academic_class_change_transaction_PROPOSAL.sql"), "utf8");
  assert.match(sql, /NÃO É MIGRAÇÃO ATIVA/);
  assert.match(sql, /public\.is_teacher_admin\(\)/);
  assert.match(sql, /for update/i);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(73008, target_class_number\)/);
  assert.match(sql, /private\.count_class_seat_holds/);
  assert.match(sql, /expected_class_numbers/);
  assert.match(sql, /private\.validate_acquisition_origin/);
  assert.match(sql, /private\.save_student_acquisition/);
  assert.match(sql, /private\.lesson_credits/);
  assert.match(sql, /unresolved_credits <> 0/);
  assert.match(sql, /private\.academic_agent_action_audit/);
  assert.match(sql, /revoke all on function public\.execute_teacher_academic_change/);
  assert.match(sql, /to authenticated;/);
});

test("planning module has browser export and cannot access Supabase by itself", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(
    path.join(root, "agents/academic_secretary_transaction_plan.js"), "utf8");
  const globals = { window: {} };
  vm.runInNewContext(source, globals);
  assert.equal(typeof globals.window.TeacherAcademicChangeTransactionPlan
    .buildAcademicChangeTransaction, "function");
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete|rpc)\s*\(/);
});

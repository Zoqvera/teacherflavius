"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261012161846_student_course_lifecycle_states.sql"), "utf8"
);

function createUiContext() {
  const source = fs.readFileSync(path.join(root, "perfil_dos_alunos.js"), "utf8")
    .replace(/\bguardPage\(\);\s*$/, "");
  const context = vm.createContext({ window: {}, Map });
  vm.runInContext(source, context, { filename: "perfil_dos_alunos.js" });
  return context;
}

test("course labels and financial exceptions are independent", () => {
  const ctx = createUiContext();
  assert.equal(vm.runInContext("getCourseStateLabel({course_status:'active'})", ctx), "Ativo com turma");
  assert.equal(vm.runInContext("getCourseStateLabel({course_status:'awaiting_class'})", ctx), "Aguardando turma");
  assert.equal(vm.runInContext("getCourseStateLabel({course_status:'paused'})", ctx), "Matrícula pausada");
  assert.equal(vm.runInContext("getStudentBillingStatusLabel({course_status:'awaiting_class',billing_active:true,billing_exemption:'none'})", ctx), "Ativa");
  assert.equal(vm.runInContext("getStudentBillingStatusLabel({course_status:'paused',billing_active:false,billing_exemption:'none'})", ctx), "Suspensa durante a pausa");
  assert.equal(vm.runInContext("getStudentBillingStatusLabel({course_status:'active',billing_active:false,billing_exemption:'permanent'})", ctx), "Isenção permanente");
});

test("course filters use persisted status, not merely no-class membership", () => {
  const ctx = createUiContext();
  assert.equal(vm.runInContext(`
    studentCourseStateMap.set('a',{course_status:'paused',billing_exemption:'none'});
    studentCourseStateMap.set('b',{course_status:'awaiting_class',billing_exemption:'none'});
    studentCourseStateMap.set('c',{course_status:'active',billing_exemption:'permanent'});
    currentStudentFilter='paused';
    filterStudents([{id:'a'}, {id:'b'}, {id:'c'}]).map(s => s.id).join(',');
  `, ctx), "a");
  assert.equal(vm.runInContext("currentStudentFilter='awaiting_class';filterStudents([{id:'a'},{id:'b'},{id:'c'}]).map(s=>s.id).join(',')",ctx), "b");
  assert.equal(vm.runInContext("currentStudentFilter='exempt';filterStudents([{id:'a'},{id:'b'},{id:'c'}]).map(s=>s.id).join(',')",ctx), "c");
});

test("financial safeguards preserve charge history and prevent suspended generation", () => {
  assert.match(migration, /CREATE TRIGGER prevent_new_tuition_during_student_pause/i);
  assert.match(migration, /NEW\.reference_month>=s\.billing_block_from_month/);
  assert.match(migration, /billing_exemption='permanent'/);
  assert.match(migration, /CREATE TRIGGER sync_course_state_on_class_membership/i);
  assert.match(migration, /billing_start_month=date_trunc\('month',next_due\)::date/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.monthly_tuition/i);
});

test("no public read or write permissions on administrative course states", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /USING \(public\.is_teacher_admin\(\)\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_teacher_student_course_state/i);
});

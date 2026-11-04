"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { createSupervisedArchiveExecutor } = require("../agents/academic_secretary_archive_executor");
const ROOT = path.join(__dirname, "..");
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";

function fixture(options = {}) {
  const calls = [];
  const state = {
    authorized: true,
    archived: false,
    classNumbers: [14],
    billingActive: true,
    billingPresent: true,
    incompleteArchive: false,
    billingError: false,
    ...options
  };
  const readers = {
    async isTeacherAuthorized() {
      calls.push("authorization");
      return state.authorized;
    },
    async getStudentSnapshot(studentId) {
      calls.push("student_snapshot");
      return {
        id: studentId,
        archived: state.archived,
        classNumbers: [...state.classNumbers]
      };
    }
  };
  const client = {
    from(table) {
      assert.equal(table, "student_billing_settings");
      const query = {
        select(fields) {
          assert.equal(fields, "student_id,active");
          return this;
        },
        eq(column, studentId) {
          assert.equal(column, "student_id");
          assert.equal(studentId, STUDENT_ID);
          return this;
        },
        async maybeSingle() {
          calls.push("billing_snapshot");
          return state.billingError
            ? { data: null, error: { message: "RLS error" } }
            : { data: state.billingPresent
              ? { student_id: STUDENT_ID, active: state.billingActive } : null, error: null };
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push("rpc." + name);
      assert.equal(name, "archive_teacher_student");
      assert.deepEqual(args, { target_user_id: STUDENT_ID });
      if (!state.incompleteArchive) {
        state.archived = true;
        state.classNumbers = [];
        state.billingActive = false;
      } else {
        state.archived = true;
      }
      return { data: null, error: null };
    }
  };
  return { client, readers, state, calls };
}

function request(extra = {}) {
  return {
    action: "archive",
    studentId: STUDENT_ID,
    expectedClassNumbers: [14],
    confirmed: true,
    ...extra
  };
}

test("successful archive verifies database postconditions", async () => {
  const { client, readers, state, calls } = fixture();
  const executor = createSupervisedArchiveExecutor(client, readers);
  const result = await executor.executeArchive(request());
  assert.deepEqual(result, {
    status: "verified", studentId: STUDENT_ID,
    archived: true, linkedClasses: 0, monthlyBillingActive: false
  });
  assert.equal(state.archived, true);
  assert.equal(state.billingActive, false);
  assert.deepEqual(calls.filter(x => x.startsWith("rpc.")), ["rpc.archive_teacher_student"]);
  assert.deepEqual(calls, [
    "authorization", "student_snapshot", "billing_snapshot", "rpc.archive_teacher_student",
    "student_snapshot", "billing_snapshot"
  ]);
});

test("no write occurs without explicit confirmation and a valid student identifier", async () => {
  const { client, readers, calls } = fixture();
  const service = createSupervisedArchiveExecutor(client, readers);
  for (const value of [
    request({ confirmed: false }),
    request({ studentId: "fake" }),
    request({ action: "unarchive" }),
    request({ expectedClassNumbers: [14, 14] })
  ]) {
    await assert.rejects(service.executeArchive(value));
  }
  assert.deepEqual(calls, []);
});

test("unprivileged users cannot archive and no data is inspected", async () => {
  const { client, readers, calls } = fixture({ authorized: false });
  await assert.rejects(
    createSupervisedArchiveExecutor(client, readers).executeArchive(request()),
    /não autorizado/
  );
  assert.deepEqual(calls, ["authorization"]);
});

test("stale class preview blocks operation before the mutation", async () => {
  const { client, readers, calls } = fixture({ classNumbers: [14, 22] });
  await assert.rejects(
    createSupervisedArchiveExecutor(client, readers).executeArchive(request()),
    /mudaram após a prévia/
  );
  assert.equal(calls.includes("rpc.archive_teacher_student"), false);
});

test("already archived student is rejected", async () => {
  const { client, readers, calls } = fixture({ archived: true });
  await assert.rejects(
    createSupervisedArchiveExecutor(client, readers).executeArchive(request()),
    /já arquivado/
  );
  assert.equal(calls.includes("rpc.archive_teacher_student"), false);
});

test("preflight billing query failure prevents writes", async () => {
  const { client, readers, calls } = fixture({ billingError: true });
  await assert.rejects(
    createSupervisedArchiveExecutor(client, readers).executeArchive(request()),
    /verificação de cobranças/
  );
  assert.equal(calls.includes("rpc.archive_teacher_student"), false);
});

test("postflight mismatch returns an error instead of a false success", async () => {
  const { client, readers, calls } = fixture({ incompleteArchive: true });
  await assert.rejects(
    createSupervisedArchiveExecutor(client, readers).executeArchive(request()),
    /integridade não pôde ser confirmada/
  );
  assert.equal(calls.includes("rpc.archive_teacher_student"), true);
});

test("students without a monthly billing setting can still be archived", async () => {
  const { client, readers } = fixture({ billingPresent: false });
  const result = await createSupervisedArchiveExecutor(client, readers).executeArchive(request());
  assert.equal(result.status, "verified");
  assert.equal(result.monthlyBillingActive, null);
});

test("browser/global export loads without exposing other write operations", () => {
  const globals = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,
    "agents/academic_secretary_archive_executor.js"), "utf8"), globals);
  assert.equal(typeof globals.window.TeacherAcademicArchiveExecutor.createSupervisedArchiveExecutor, "function");
  const source = fs.readFileSync(path.join(ROOT, "agents/academic_secretary_archive_executor.js"), "utf8");
  assert.match(source, /\.rpc\("archive_teacher_student"/);
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(source, /unarchive_teacher_student/);
});

test("UI requires a second approval and retains no executing preview after selection changes", () => {
  const html = fs.readFileSync(path.join(ROOT, "agente-secretaria/index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "agente-secretaria/app.js"), "utf8");
  assert.match(html, /id="archiveConsent"/);
  assert.match(html, /id="archiveExecute" type="button" disabled/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /academic_secretary_archive_executor\.js/);
  assert.match(app, /window\.confirm\("Confirma o ARQUIVAMENTO/);
  assert.match(app, /archiveReview = null/);
  assert.match(app, /archiveExecutor\.executeArchive\(request\)/);
  assert.doesNotMatch(app, /\.rpc\("archive_teacher_student"/);
});

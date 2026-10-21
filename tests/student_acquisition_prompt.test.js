"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = filename => fs.readFileSync(path.join(root, filename), "utf8");
const prompt = require("../student_acquisition_prompt.js");

function makeClient(options = {}) {
  const calls = [];
  const profile = options.profile || { enrolled: true, archived: false };
  const source = options.source === undefined ? null : options.source;
  const client = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select(columns) {
          assert.equal(columns, "enrolled,archived");
          return {
            eq(column, value) {
              assert.equal(column, "id");
              assert.equal(value, "student-1");
              return {
                async maybeSingle() {
                  return { data: profile, error: options.profileError || null };
                }
              };
            }
          };
        }
      };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "get_my_student_acquisition") {
        return { data: { source }, error: options.sourceError || null };
      }
      if (name === "submit_my_student_acquisition") {
        return {
          data: options.submitResult === undefined ? true : options.submitResult,
          error: options.submitError || null
        };
      }
      throw new Error("Unexpected RPC: " + name);
    }
  };
  return { client, calls };
}

function makeDom() {
  const handlers = {};
  const elements = {
    studentAcquisitionPromptForm: {
      addEventListener(type, fn) { handlers["submit"] = fn; }
    },
    studentAcquisitionPromptSubmit: { disabled: false },
    studentAcquisitionPromptClose: {
      disabled: false,
      addEventListener(type, fn) { handlers["close"] = fn; }
    },
    studentAcquisitionPromptError: { textContent: "", hidden: true },
    studentAcquisitionSaved: { textContent: "", hidden: true }
  };
  const dialog = {
    opened: false,
    showModal() { this.opened = true; },
    close() { this.opened = false; }
  };
  const documentRef = {
    getElementById(id) { return id === "studentAcquisitionPrompt" ? dialog : elements[id]; },
    querySelector() { return null; }
  };
  const service = {
    setupCount: 0,
    setup(sourceId, detailId) {
      assert.equal(sourceId, "studentAcquisitionPromptSource");
      assert.equal(detailId, "studentAcquisitionPromptDetail");
      this.setupCount += 1;
    },
    read() { return { source: "getninjas", detail: null }; }
  };
  return { dialog, documentRef, service, elements, handlers };
}

test("only enrolled students with an unrecorded source are eligible", () => {
  assert.equal(prompt.shouldShowPrompt(
    { data: { enrolled: true, archived: false } },
    { data: { source: null } }
  ), true);
  for (const source of ["instagram", "chatgpt", "unknown", "referral"]) {
    assert.equal(prompt.shouldShowPrompt(
      { data: { enrolled: true, archived: false } },
      { data: { source } }
    ), false);
  }
  assert.equal(prompt.shouldShowPrompt(
    { data: { enrolled: false, archived: false } },
    { data: { source: null } }
  ), false);
  assert.equal(prompt.shouldShowPrompt(
    { data: { enrolled: true, archived: true } },
    { data: { source: null } }
  ), false);
  assert.throws(() => prompt.shouldShowPrompt(
    { data: null, error: new Error("permission denied") },
    { data: {} }
  ), /permission denied/);
});

test("students who already responded do not see the dialog", async () => {
  const { client, calls } = makeClient({ source: "google" });
  const dom = makeDom();
  assert.equal(await prompt.initialize({
    client, studentId: "student-1", documentRef: dom.documentRef,
    acquisitionService: dom.service
  }), false);
  assert.equal(dom.dialog.opened, false);
  assert.equal(calls.length, 1);
});

test("the teacher does not see the survey", async () => {
  const { client, calls } = makeClient();
  const dom = makeDom();
  assert.equal(await prompt.initialize({
    client, studentId: "student-1", documentRef: dom.documentRef,
    acquisitionService: dom.service, isProfessor: true
  }), false);
  assert.equal(calls.length, 0);
});

test("the student's GetNinjas response saves and closes the dialog", async () => {
  const { client, calls } = makeClient();
  const dom = makeDom();
  assert.equal(await prompt.initialize({
    client, studentId: "student-1", documentRef: dom.documentRef,
    acquisitionService: dom.service
  }), true);
  assert.equal(dom.dialog.opened, true);
  assert.equal(dom.service.setupCount, 1);

  await dom.handlers.submit({ preventDefault() {} });
  assert.equal(dom.dialog.opened, false);
  assert.equal(dom.elements.studentAcquisitionSaved.textContent, "Resposta registrada. Obrigado!");
  assert.equal(dom.elements.studentAcquisitionPromptSubmit.disabled, false);
  assert.deepEqual(calls.at(-1), {
    name: "submit_my_student_acquisition",
    args: { target_source: "getninjas", target_detail: null }
  });
});

test("a database error keeps the dialog open and displays feedback", async () => {
  const { client } = makeClient({ submitError: new Error("Falha temporária") });
  const dom = makeDom();
  await prompt.initialize({
    client, studentId: "student-1", documentRef: dom.documentRef,
    acquisitionService: dom.service
  });
  await dom.handlers.submit({ preventDefault() {} });
  assert.equal(dom.dialog.opened, true);
  assert.equal(dom.elements.studentAcquisitionPromptError.hidden, false);
  assert.match(dom.elements.studentAcquisitionPromptError.textContent, /Falha temporária/);
});

test("an unanswered dialog can be dismissed without saving", async () => {
  const { client, calls } = makeClient();
  const dom = makeDom();
  await prompt.initialize({
    client, studentId: "student-1", documentRef: dom.documentRef,
    acquisitionService: dom.service
  });
  dom.handlers.close();
  assert.equal(dom.dialog.opened, false);
  assert.equal(calls.filter(call => call.name === "submit_my_student_acquisition").length, 0);
});

test("catalog, protected write path and dashboard integration share one source of truth", () => {
  const catalog = read("student_acquisition.js");
  const migration = read("supabase/migrations/20261017015220_student_acquisition_getninjas_popup.sql");
  const html = read("area_do_estudante.html");
  const dashboard = read("area_do_estudante.js");

  assert.match(catalog, /value: "getninjas", label: "GetNinjas"/);
  assert.match(migration, /submit_my_student_acquisition/);
  assert.match(migration, /id = \(select auth.uid\(\)\)/);
  assert.match(migration, /declared_source is not null/);
  assert.match(migration, /private.save_student_acquisition/);
  assert.match(migration, /grant execute on function public.submit_my_student_acquisition/);
  assert.match(html, /studentAcquisitionPromptSource/);
  assert.ok(dashboard.indexOf("await initializeAcquisitionPrompt()") <
    dashboard.indexOf("if (!acquisitionPromptShown) await initializeReviewInvitation()"));
});

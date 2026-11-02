"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(ROOT, name), "utf8");

test("private academic secretary page has a strict read-only HTML surface", () => {
  const html = read("agente-secretaria/index.html");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<section id="workspace" hidden/);
  assert.match(html, /<script defer src="\/agents\/academic_secretary.js/);
  assert.match(html, /<script defer src="\/agents\/academic_secretary_supabase.js/);
  assert.match(html, /<script defer src="\/agente-secretaria\/app.js/);
  assert.match(html, /id="planForm"/);
  assert.match(html, /id="searchForm"/);
  assert.match(html, /Gerar prévia \(sem executar\)/);
  assert.doesNotMatch(html, /type="submit"[^>]*>[^<]*(arquivar|matricular|transferir)/i);
  assert.match(read("professor_home.js"), /href: "\/agente-secretaria\/"/);
});

test("browser global modules load without CommonJS and retain Node compatibility", async () => {
  const globals = { window: {} };
  vm.runInNewContext(read("agents/academic_secretary.js"), globals);
  vm.runInNewContext(read("agents/academic_secretary_supabase.js"), globals);
  const planner = globals.window.TeacherAcademicSecretaryAgent;
  const adapter = globals.window.TeacherAcademicSecretarySupabase;
  assert.equal(typeof planner.createAcademicSecretaryAgent, "function");
  assert.equal(typeof adapter.createAcademicSecretarySupabaseService, "function");
  assert.equal(typeof require("../agents/academic_secretary").createAcademicSecretaryAgent, "function");
  assert.equal(typeof require("../agents/academic_secretary_supabase").createAcademicSecretarySupabaseService, "function");

  const agent = planner.createAcademicSecretaryAgent({
    async isTeacherAuthorized() { return true; },
    async getStudentSnapshot(id) { return { id, archived: false, classNumbers: [] }; },
    async getClassSnapshot(number) { return { number, availableSeats: 1 }; }
  });
  const result = await agent.plan({
    action: "new_link", studentId: "mock", classNumber: 20
  });
  assert.equal(result.status, "needs_input");
  assert.deepEqual(Array.from(result.missingFields), ["source", "firstLessonDate"]);
  assert.equal(result.readOnly, true);
});

test("admin interface verifies access before exposing student lookup", () => {
  const app = read("agente-secretaria/app.js");
  assert.match(app, /ui\.workspace\.hidden = true/);
  assert.match(app, /Auth\.requireAuth\(\{ skipProfileCheck: true \}\)/);
  assert.match(app, /Auth\.isTeacherAdmin\(\)/);
  assert.match(app, /rpc\("is_teacher_admin"\)/);
  assert.match(app, /select\("id,name,archived,enrolled"\)/);
  assert.match(app, /createAcademicSecretarySupabaseService\(client\)/);
  assert.match(app, /ui\.workspace\.hidden = false/);
});

test("the administrative panel cannot execute data mutations", () => {
  const app = read("agente-secretaria/app.js");
  const api = read("agents/academic_secretary_supabase.js");
  for (const source of [app, api]) {
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete|remove)\s*\(/);
    assert.doesNotMatch(source, /\.rpc\(\s*["'](?:archive|unarchive|add_teacher|remove_teacher|set_teacher)/);
  }
  assert.doesNotMatch(app, /\.innerHTML\s*=/);
  assert.match(app, /\.textContent\s*=/);
});

test("new link requests contain origin and first lesson, transfers do not", () => {
  const app = read("agente-secretaria/app.js");
  assert.match(app, /request\.action === "transfer"[\s\S]*?request\.fromClassNumber/);
  assert.match(app, /request\.action === "new_link"[\s\S]*?request\.source[\s\S]*?request\.firstLessonDate/);
  assert.match(app, /ui\.source\.required = isLink/);
  assert.match(app, /ui\.firstLessonDate\.required = isLink/);
  assert.match(app, /ui\.transferFields\.hidden = !isTransfer/);
});

test("new page does not claim payment processing or activate student operations", () => {
  const html = read("agente-secretaria/index.html");
  assert.match(html, /Nenhuma alteração será realizada nesta página/);
  assert.doesNotMatch(html, /Pagamento confirmado|Crédito concedido|Matrícula realizada/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const serviceSource = fs.readFileSync(path.join(ROOT, "academic_workflow_service.js"), "utf8");
const actionPlanSource = fs.readFileSync(path.join(ROOT, "o-que-fazer/app.js"), "utf8");
const lessonSource = fs.readFileSync(path.join(ROOT, "licao.js"), "utf8");
const actionPlanPage = fs.readFileSync(path.join(ROOT, "o-que-fazer/index.html"), "utf8");
const lessonPage = fs.readFileSync(path.join(ROOT, "licao/index.html"), "utf8");

function createService(profile, error = null) {
  const browser = { window: {} };
  vm.runInNewContext(serviceSource, browser);
  const client = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select(columns) {
          assert.equal(columns, "enrolled,archived");
          return {
            eq(column, userId) {
              assert.equal(column, "id");
              assert.equal(userId, "student-123");
              return {
                maybeSingle: async () => ({ data: profile, error })
              };
            }
          };
        }
      };
    },
    rpc() {
      assert.fail("Eligibility checks must not execute student-only RPCs");
    }
  };

  return browser.window.AcademicWorkflowService.create(client);
}

test("student eligibility permits only enrolled, non-archived profiles", async () => {
  assert.equal(await createService({ enrolled: true, archived: false }).isActiveStudent("student-123"), true);
  assert.equal(await createService({ enrolled: false, archived: false }).isActiveStudent("student-123"), false);
  assert.equal(await createService({ enrolled: true, archived: true }).isActiveStudent("student-123"), false);
  assert.equal(await createService(null).isActiveStudent("student-123"), false);
  assert.equal(await createService(null).isActiveStudent(null), false);
});

test("eligibility query failures are not silently interpreted as denied access", async () => {
  const service = createService(null, new Error("Database unavailable"));
  await assert.rejects(service.isActiveStudent("student-123"), /Database unavailable/);
});

test("O QUE FAZER validates active student access before calling student RPCs", () => {
  assert.match(actionPlanSource, /await service\.isActiveStudent\(session\.user\.id\)/);
  assert.match(actionPlanSource, /if \(!activeStudent\) \{/);
  assert.match(actionPlanSource, /Esta página está disponível apenas para alunos ativos\./);
  const initializeSource = actionPlanSource.slice(actionPlanSource.indexOf("async function initialize()"));
  assert.ok(
    initializeSource.indexOf("await service.isActiveStudent(session.user.id)") <
    initializeSource.indexOf("await loadPlan();")
  );
});

test("lesson previews skip student-specific preparation for non-active accounts", () => {
  assert.match(lessonSource, /canPrepareLesson = await academicService\.isActiveStudent\(session\.user\.id\)/);
  assert.match(lessonSource, /if \(!lessonNumber \|\| !canPrepareLesson\) \{/);
  assert.match(lessonSource, /await setupPreparation\(lessonNumber\)/);
  assert.match(lessonSource, /renderDynamicPage\(page\)/);
});

test("student pages load the updated versioned scripts without changing indexing rules", () => {
  for (const page of [actionPlanPage, lessonPage]) {
    assert.match(page, /academic_workflow_service\.js\?v=20261022-apresentacoes-1/);
    assert.match(page, /<meta name="robots" content="noindex[, ]+nofollow">/);
  }
  assert.match(actionPlanPage, /o-que-fazer\/app\.js\?v=20261026-no-legacy-flash-1/);
  assert.match(lessonPage, /licao\.js\?v=20261022-apresentacoes-1/);
});

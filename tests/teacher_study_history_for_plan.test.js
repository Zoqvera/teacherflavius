const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261022153922_teacher_study_history_for_plan_20261022.sql");
const serviceSource = read("academic_workflow_service.js");
const teacherApp = read("roteiro-da-aula/app.js");
const teacherPage = read("roteiro-da-aula/index.html");
const css = read("academic_workflow.css");

test("history RPC is teacher-only and reads first study dates without writing them", () => {
  assert.match(sql, /create or replace function public\.get_teacher_study_history_for_plan/i);
  assert.match(sql, /public\.is_teacher_admin\(\)/i);
  assert.match(sql, /from public\.get_teacher_lesson_plan\(effective_date\)/i);
  assert.match(sql, /from private\.student_question_studies study/i);
  assert.match(sql, /prior\.attendance_status in \('present', 'absent'\)/i);
  assert.match(sql, /study\.studied_at < cycle\.previous_class_start/i);
  assert.match(sql, /study\.studied_at >= coalesce\(cycle\.previous_class_start/i);
  assert.match(sql, /grant execute on function public\.get_teacher_study_history_for_plan\(date\)[\s\S]*to authenticated, service_role/i);
  assert.match(sql, /revoke all on function public\.get_teacher_study_history_for_plan\(date\) from public, anon/i);
  assert.doesNotMatch(sql, /(?:delete|truncate|update)\s+(?:from\s+)?private\.student_question_studies/i);
});

test("teacher sees a number-only, compact history immediately above the current cycle", () => {
  assert.match(teacherApp, /renderPreviouslyStudiedQuestions\(item\.previously_studied_numbers\)/);
  assert.match(teacherApp, /PERGUNTAS ESTUDADAS ANTERIORMENTE/);
  assert.match(teacherApp, /PERGUNTAS ESTUDADAS PARA HOJE/);
  assert.match(teacherApp, /Array\.from\(new Set\(/);
  assert.match(teacherApp, /orderedNumbers\.length > 20/);
  assert.match(teacherApp, /element\("details"/);
  assert.match(teacherApp, /"academic-history-number", String\(number\)/);
  assert.match(teacherApp, /"PERGUNTAS ESTUDADAS PARA HOJE",[\s\S]*item\.today_questions/);
  assert.match(css, /\.academic-history-numbers\s*\{[\s\S]*flex-wrap: wrap/);
  assert.match(teacherPage, /<meta name="robots" content="noindex, nofollow">/);
});

test("study cycle is hydrated separately from already rated questions and review queue", async () => {
  const context = { window: {} };
  vm.runInNewContext(serviceSource, context, { filename: "academic_workflow_service.js" });

  const startsAt = "2026-10-22T18:00:00+00:00";
  const calls = [];
  const client = {
    rpc(name) {
      calls.push(name);
      if (name === "get_teacher_lesson_plan") {
        return Promise.resolve({ data: [{
          student_id: "student-1",
          starts_at: startsAt,
          new_questions: [{ id: "q-1", display_order: 1 }],
          review_questions: [{ id: "q-4", display_order: 4 }]
        }], error: null });
      }
      if (name === "get_teacher_study_history_for_plan") {
        return Promise.resolve({ data: [{
          student_id: "student-1",
          starts_at: startsAt,
          previously_studied_numbers: [2, 5, 9],
          today_questions: [
            { id: "q-1", display_order: 1 },
            { id: "q-3", display_order: 3 }
          ]
        }], error: null });
      }
      throw new Error("Unexpected RPC: " + name);
    },
    from(table) {
      assert.equal(table, "conversation_questions");
      return {
        select() {
          return {
            in(column, ids) {
              assert.equal(column, "id");
              assert.ok(ids.includes("q-1"));
              assert.ok(ids.includes("q-3"));
              assert.ok(ids.includes("q-4"));
              return Promise.resolve({ data: [], error: null });
            }
          };
        }
      };
    }
  };

  const plan = await context.window.AcademicWorkflowService.create(client)
    .getTeacherLessonPlan("2026-10-22");

  assert.equal(plan.length, 1);
  assert.equal(plan[0].previously_studied_numbers.join(","), "2,5,9");
  assert.equal(plan[0].today_questions.map((q) => q.id).join(","), "q-1,q-3");
  assert.equal(plan[0].new_questions.map((q) => q.id).join(","), "q-1");
  assert.equal(plan[0].review_questions.map((q) => q.id).join(","), "q-4");
  assert.equal(calls.includes("get_teacher_study_history_for_plan"), true);
});

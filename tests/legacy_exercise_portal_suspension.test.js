"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (filePath) => fs.readFileSync(path.join(ROOT, filePath), "utf8");

test("all legacy student exercise entrypoints display suspension without exercise links", function () {
  for (const filePath of [
    "exercicios-diarios/index.html",
    "exercicios.diarios.html",
    "exercicios_diarios.html"
  ]) {
    const content = read(filePath);
    assert.match(content, /Portal de Exercícios temporariamente indisponível/);
    assert.match(content, /href="\/area-do-estudante\/"/);
    assert.doesNotMatch(content, /get_public_teacher_exercises|google\.com\/forms|fetch\(['"]\/exercicios\.diarios\.html/);
  }
});

test("the student area no longer offers exercises or overdue popups", function () {
  const html = read("area_do_estudante.html");
  const script = read("area_do_estudante.js");
  assert.doesNotMatch(html, /PORTAL DE EXERCÍCIOS|id="overdueModal"|href="\/exercicios-diarios\/"/);
  assert.doesNotMatch(script, /get_public_teacher_exercises|showOverdueActivityIfNeeded|daily_exercise_completion/);
});

test("Minha Semana excludes suspended exercises from assignments and progress", function () {
  const script = read("minha_semana_dashboard.js");
  assert.doesNotMatch(script, /get_public_teacher_exercises|daily_exercise_completion|exercicios-diarios|currentExercise/);
  assert.match(script, /flashcard_practice_days/);
  assert.match(script, /grammar_lesson_completion/);
  assert.match(script, /student_frequency/);
});

test("database restricts the legacy catalog to teachers without deleting records", function () {
  const sql = read("supabase/migrations/20261015135322_suspend_legacy_student_exercise_portal.sql");
  assert.match(sql, /create policy "Apenas professores/);
  assert.match(sql, /where public\.is_teacher_admin\(\)/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.teacher_exercises|truncate\s+table/i);
});

test("student area fetches a versioned, uncached HTML document", function () {
  const shell = read("area-do-estudante/index.html");
  const html = read("area_do_estudante.html");

  assert.match(shell, /sourcePage \+ "\\?v=20261015-suspend-exercises-2"/);
  assert.match(shell, /cache: 'no-store'/);
  assert.match(html, /area_do_estudante\\.js\\?v=20261015-suspend-exercises-2/);
});

test("stale student-area cards for the suspended portal are removed", async function () {
  const vm = require("node:vm");
  const removed = [];
  const candidates = [
    "/exercicios-diarios/",
    "/exercicios-diarios",
    "https://teacherflavius.com/exercicios-diarios/?from=pwa",
    "/flashcards/",
    "https://example.com/exercicios-diarios/"
  ];
  const links = candidates.map(function (href) {
    return {
      getAttribute: function (name) {
        return name === "href" ? href : null;
      },
      remove: function () {
        removed.push(href);
      }
    };
  });

  const documentMock = {
    querySelectorAll: function () {
      return links;
    },
    querySelector: function () {
      return null;
    },
    getElementById: function () {
      return null;
    },
    body: { classList: { remove: function () {} } }
  };
  const windowMock = {
    location: {
      href: "https://teacherflavius.com/area-do-estudante/",
      origin: "https://teacherflavius.com"
    },
    ResourceWaiter: {
      waitUntil: function () {
        return Promise.resolve(false);
      }
    }
  };

  vm.runInNewContext(read("area_do_estudante.js"), {
    document: documentMock,
    window: windowMock,
    URL,
    console
  });
  await Promise.resolve();
  assert.deepEqual(removed, candidates.slice(0, 3));
});

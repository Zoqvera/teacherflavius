"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const roadmapHtml = fs.readFileSync(
  path.join(__dirname, "..", "roteiro_de_estudos.html"),
  "utf8"
);

function createRoadmapHarness() {
  const match = roadmapHtml.match(/<script>\s*(let currentUser = null;[\s\S]*?)<\/script>/);
  assert.ok(match, "O script do roteiro de estudos deve existir");

  const grid = { innerHTML: "" };
  const window = {
    StudyLessonService: {
      EXISTING_ROADMAP_CARD_COUNT: 24,
      lessonPageUrl: (id) => "/licao/?id=" + id
    }
  };
  const document = {
    getElementById(id) {
      assert.equal(id, "lessonsGrid");
      return grid;
    }
  };
  const script = match[1].replace(/\s*guardPage\(\);\s*$/, "");
  const helpers = `
    window.roadmapTest = {
      setLinkedPages(pages) {
        linkedLessonPages = new Map(
          pages.map((page) => [page.roadmap_lesson_number, page])
        );
      },
      formatLessonCardTitle,
      renderLessons
    };
  `;

  vm.runInNewContext(script + helpers, { window, document });
  return { grid, roadmap: window.roadmapTest };
}

test("all linked lessons use uppercase numbered titles", () => {
  const { grid, roadmap } = createRoadmapHarness();
  const pages = Array.from({ length: 33 }, (_, index) => ({
    id: "test-page-" + (index + 1),
    roadmap_lesson_number: index + 1,
    title: "Topic " + (index + 1)
  }));
  roadmap.setLinkedPages(pages);
  roadmap.renderLessons();

  const titles = Array.from(
    grid.innerHTML.matchAll(
      /<a class="lesson-title"[^>]*><span><span class="icon">.*?<\/span>(.*?)<\/span><span class="arrow">/g
    ),
    (match) => match[1]
  );

  assert.equal(titles.length, 33);
  pages.forEach((page, index) => {
    assert.equal(titles[index], "APRESENTAÇÃO " + page.roadmap_lesson_number + " - " + page.title.toLocaleUpperCase("pt-BR"));
  });
});

test("formatting preserves registered titles and safely escapes them in cards", () => {
  const { grid, roadmap } = createRoadmapHarness();
  assert.equal(
    roadmap.formatLessonCardTitle(7, { title: "  Home sweet home  " }),
    "APRESENTAÇÃO 7 - HOME SWEET HOME"
  );
  assert.equal(roadmap.formatLessonCardTitle(7, null), "APRESENTAÇÃO 7");

  roadmap.setLinkedPages([
    { id: "test-page-1", roadmap_lesson_number: 1, title: "English & <pronouns>" }
  ]);
  roadmap.renderLessons();

  assert.match(grid.innerHTML, /APRESENTAÇÃO 1 - ENGLISH &amp; &lt;PRONOUNS&gt;/);
  assert.doesNotMatch(grid.innerHTML, /English & <pronouns>/);

  assert.match(
    grid.innerHTML,
    /<p class="lesson-description">Nesta aula, você vai aprender a se apresentar/
  );
  assert.doesNotMatch(grid.innerHTML, /NESTA AULA, VOCÊ VAI APRENDER/);
});

test("new card descriptions retain their original letter case", () => {
  const { grid, roadmap } = createRoadmapHarness();
  roadmap.setLinkedPages([
    {
      id: "test-page-25",
      roadmap_lesson_number: 25,
      title: "Feelings & Emotions",
      objective: "Practice describing how you feel in English."
    }
  ]);
  roadmap.renderLessons();

  assert.match(grid.innerHTML, /APRESENTAÇÃO 25 - FEELINGS &amp; EMOTIONS/);
  assert.match(
    grid.innerHTML,
    /<p class="lesson-description">Practice describing how you feel in English\.<\/p>/
  );
  assert.doesNotMatch(grid.innerHTML, /PRACTICE DESCRIBING HOW YOU FEEL/);
});

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

test("all linked lessons use the same numbered title pattern", () => {
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
    assert.equal(titles[index], "Lição " + page.roadmap_lesson_number + " - " + page.title);
  });
});

test("formatting preserves registered titles and safely escapes them in cards", () => {
  const { grid, roadmap } = createRoadmapHarness();
  assert.equal(
    roadmap.formatLessonCardTitle(7, { title: "  Home sweet home  " }),
    "Lição 7 - Home sweet home"
  );
  assert.equal(roadmap.formatLessonCardTitle(7, null), "Lição 7");

  roadmap.setLinkedPages([
    { id: "test-page-1", roadmap_lesson_number: 1, title: "English & <pronouns>" }
  ]);
  roadmap.renderLessons();

  assert.match(grid.innerHTML, /Lição 1 - English &amp; &lt;pronouns&gt;/);
  assert.doesNotMatch(grid.innerHTML, /English & <pronouns>/);
});

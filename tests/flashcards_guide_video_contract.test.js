const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "flashcards.html"), "utf8");
const styles = fs.readFileSync(path.join(ROOT, "flashcards.css"), "utf8");

test("flashcards page embeds the requested guide video above the library heading", function () {
  const guideIndex = page.indexOf('class="flashcard-guide"');
  const libraryIndex = page.indexOf('<p class="eyebrow">SUA BIBLIOTECA</p>');

  assert.ok(guideIndex >= 0);
  assert.ok(libraryIndex > guideIndex);
  assert.match(page, /youtube-nocookie\.com\/embed\/p3SvVh8QtUo\?rel=0/);
  assert.match(page, /loading="lazy"/);
  assert.match(page, /allowfullscreen/);
  assert.match(page, /aria-label="Como usar flashcards"/);
  assert.doesNotMatch(page, /Entenda o recurso antes de começar/);
});

test("flashcards guide video is responsive", function () {
  assert.match(styles, /\.flashcard-video-frame\s*\{/);
  assert.match(styles, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(styles, /\.flashcard-video-frame iframe\s*\{/);
  assert.match(styles, /width:\s*100%/);
  assert.match(styles, /height:\s*100%/);
});

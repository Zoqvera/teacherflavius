"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const actionPlanPage = read("o-que-fazer/index.html");
const conversationPage = read("conversation-questions/index.html");
const styles = read("academic_workflow.css");

test("conversation panel links to the complete question catalog in the requested position", () => {
  const panelStart = actionPlanPage.indexOf('<section class="academic-panel" aria-labelledby="questionsTitle">');
  assert.ok(panelStart >= 0, "conversation panel must exist");

  const panel = actionPlanPage.slice(panelStart, actionPlanPage.indexOf("</section>", panelStart));
  assert.match(
    panel,
    /<div class="academic-conversation-topline">\s*<p class="academic-kicker">CONVERSAÇÃO<\/p>\s*<a class="academic-all-questions-link" href="\/conversation-questions\/">TODAS AS PERGUNTAS<\/a>\s*<\/div>\s*<h2 id="questionsTitle">Perguntas para estudar<\/h2>/
  );
  assert.match(conversationPage, /<h1>Conversation Questions<\/h1>/);
  assert.match(actionPlanPage, /academic_workflow\.css\?v=20261014-all-questions-link-1/);
});

test("conversation link remains responsive and keyboard accessible", () => {
  assert.match(styles, /\.academic-conversation-topline\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/s);
  assert.match(styles, /\.academic-all-questions-link\s*\{[^}]*min-height: 40px;/s);
  assert.match(styles, /\.academic-all-questions-link:focus-visible\s*\{[^}]*outline:/s);
});

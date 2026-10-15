"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(
  path.join(__dirname, "..", "student_preparation_flow.js"),
  "utf8"
);

function evaluate(hostname) {
  const tags = [];
  const existingMeta = { name: "robots", content: "index,follow" };
  const document = {
    head: { appendChild(node) { tags.push(node); } },
    querySelector(selector) {
      assert.equal(selector, 'meta[name="robots"]');
      return existingMeta;
    },
    createElement() {
      throw new Error("An existing robots tag must be reused in the fixture.");
    }
  };
  const window = { location: { hostname }, document };
  vm.runInNewContext(script, { window });
  return { flag: window.StudentPreparationFlow, robots: existingMeta.content, tags };
}

test("production domains remain on the original preparation experience", () => {
  for (const hostname of [
    "teacherflavius.com",
    "www.teacherflavius.com",
    "teacherflavius.handinhandengl.workers.dev",
    "",
    "stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev.evil.example"
  ]) {
    const result = evaluate(hostname);
    assert.equal(result.flag.enabled, false, hostname);
    assert.equal(result.robots, "index,follow", hostname);
  }
});

test("only the exact approved stage6 preview hostname opts in", () => {
  const result = evaluate(
    "stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev"
  );
  assert.equal(result.flag.enabled, true);
  assert.equal(result.robots, "noindex,nofollow");
  assert.equal(result.flag.secondPartUrl, "/o-que-fazer/segunda-parte/");
  assert.equal(result.tags.length, 0);
  assert.equal(Object.isFrozen(result.flag), true);
});

test("the rollout stays disabled when no hostname is available", () => {
  const window = {};
  vm.runInNewContext(script, { window });
  assert.equal(window.StudentPreparationFlow.enabled, false);
});

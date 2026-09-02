const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadGuard() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "site_enrollment_guard.js"),
    "utf8"
  );
  const context = {
    URL: URL,
    window: {
      location: {
        href: "https://teacherflavius.com/professor/",
        origin: "https://teacherflavius.com"
      }
    }
  };

  vm.runInNewContext(source, context);
  return context.window.SiteEnrollmentGuard;
}

test("identifies clean enrollment route", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("/matricula/"), true);
});

test("keeps compatibility with legacy enrollment route", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("/matricula.html"), true);
});

test("rejects external enrollment URLs", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("https://example.com/matricula/"), false);
});

test("rejects similar non-enrollment paths", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("/matriculas/"), false);
  assert.equal(guard.isEnrollmentLink("/matricula-extra/"), false);
});

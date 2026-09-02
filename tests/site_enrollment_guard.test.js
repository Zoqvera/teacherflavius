const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function loadGuard() {
  const source = fs.readFileSync(path.join(__dirname, "..", "site_enrollment_guard.js"), "utf8");
  const context = {
    URL: URL,
    window: {
      location: {
        href: "https://teacherflavius.com/area-do-estudante/",
        origin: "https://teacherflavius.com"
      }
    },
    document: {
      querySelectorAll: function () { return []; },
      documentElement: {}
    },
    MutationObserver: function () {
      this.observe = function () {};
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.SiteEnrollmentGuard;
}

test("recognizes canonical enrollment route", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("/matricula/"), true);
});

test("recognizes legacy enrollment route", function () {
  const guard = loadGuard();
  const legacyPath = "/matricula" + ".html";
  assert.equal(guard.isEnrollmentLink(legacyPath), true);
});

test("rejects unrelated same-origin routes", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("/curso-de-ingles-online/"), false);
});

test("rejects external enrollment-looking routes", function () {
  const guard = loadGuard();
  assert.equal(guard.isEnrollmentLink("https://example.com/matricula/"), false);
});

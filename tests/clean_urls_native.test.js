const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "clean_urls.js"), "utf8");

test("does not normalize explicit Android routes inside Capacitor", function () {
  let documentTouched = false;
  let historyTouched = false;

  const windowRef = {
    TeacherFlaviusCleanUrlsInstalled: false,
    Capacitor: {
      isNativePlatform: function () { return true; }
    },
    location: {
      pathname: "/area-do-estudante/index.html",
      href: "https://localhost/area-do-estudante/index.html",
      origin: "https://localhost"
    },
    history: {
      state: null,
      replaceState: function () { historyTouched = true; }
    },
    self: null,
    top: null,
    URL: URL,
    MutationObserver: function () {}
  };
  windowRef.self = windowRef;
  windowRef.top = windowRef;

  const documentRef = {
    readyState: "complete",
    baseURI: "https://localhost/area-do-estudante/index.html",
    get documentElement() {
      documentTouched = true;
      return {};
    },
    querySelector: function () {
      documentTouched = true;
      return null;
    },
    querySelectorAll: function () {
      documentTouched = true;
      return [];
    }
  };

  vm.runInNewContext(SOURCE, {
    window: windowRef,
    document: documentRef,
    URL: URL,
    MutationObserver: windowRef.MutationObserver,
    console: console
  });

  assert.equal(windowRef.TeacherFlaviusCleanUrlsInstalled, true);
  assert.equal(documentTouched, false);
  assert.equal(historyTouched, false);
});

test("keeps web clean URL behavior enabled", function () {
  const source = SOURCE;
  assert.match(source, /function cleanInternalUrl/);
  assert.match(source, /function normalizeCurrentAddress/);
  assert.match(source, /if \(isNativeCapacitorApp\(\)\) return;/);
});

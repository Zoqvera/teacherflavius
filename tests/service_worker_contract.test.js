const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");

function loadWorker() {
  const handlers = {};
  const context = {
    URL: URL,
    fetch: function () { return Promise.resolve({ ok: true, clone: function () { return this; } }); },
    caches: {
      open: function () { return Promise.resolve({ addAll: function () { return Promise.resolve(); }, put: function () { return Promise.resolve(); } }); },
      keys: function () { return Promise.resolve([]); },
      delete: function () { return Promise.resolve(true); },
      match: function () { return Promise.resolve(null); }
    },
    self: {
      location: { origin: "https://teacherflavius.com" },
      clients: { claim: function () { return Promise.resolve(); } },
      skipWaiting: function () { return Promise.resolve(); },
      addEventListener: function (name, handler) { handlers[name] = handler; }
    }
  };

  vm.runInNewContext(SOURCE, context);
  return handlers;
}

test("does not intercept page navigations", function () {
  const handlers = loadWorker();
  let intercepted = false;
  handlers.fetch({
    request: { method: "GET", url: "https://teacherflavius.com/area-do-estudante/" },
    respondWith: function () { intercepted = true; }
  });
  assert.equal(intercepted, false);
});

test("intercepts only the install assets on the same origin", function () {
  const handlers = loadWorker();
  let intercepted = false;
  handlers.fetch({
    request: { method: "GET", url: "https://teacherflavius.com/assets/favicon-192.png" },
    respondWith: function () { intercepted = true; }
  });
  assert.equal(intercepted, true);
});

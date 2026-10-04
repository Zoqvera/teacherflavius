const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "pwa_registration.js"), "utf8");

function execute(options) {
  const settings = options || {};
  const registrations = [];
  let loadHandler = null;
  const navigatorRef = settings.supported === false
    ? {}
    : {
        serviceWorker: {
          register: function (url, config) {
            registrations.push({ url: url, config: config });
            return Promise.resolve({ scope: config.scope });
          }
        }
      };

  const windowRef = {
    navigator: navigatorRef,
    addEventListener: function (eventName, handler) {
      if (eventName === "load") loadHandler = handler;
    }
  };
  const context = {
    window: windowRef,
    document: { readyState: settings.readyState || "complete" },
    console: { warn: function () {} },
    Promise: Promise
  };

  vm.runInNewContext(SOURCE, context);
  return { windowRef: windowRef, registrations: registrations, load: function () { if (loadHandler) loadHandler(); } };
}

test("registers the root-scoped service worker without HTTP cache reuse", function () {
  const result = execute();
  assert.equal(result.registrations.length, 1);
  assert.equal(result.registrations[0].url, "/service-worker.js");
  assert.equal(result.registrations[0].config.scope, "/");
  assert.equal(result.registrations[0].config.updateViaCache, "none");
});

test("does not fail when service workers are unsupported", function () {
  const result = execute({ supported: false });
  assert.equal(result.registrations.length, 0);
});

test("waits for window load while the document is still loading", function () {
  const result = execute({ readyState: "loading" });
  assert.equal(result.registrations.length, 0);
  result.load();
  assert.equal(result.registrations.length, 1);
});

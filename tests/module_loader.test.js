const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MODULE_LOADER_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "module_loader.js"),
  "utf8"
);

class FakeScript {
  constructor(src) {
    this.src = src || "";
    this.readyState = "";
    this.async = false;
    this.listeners = new Map();
  }

  addEventListener(type, callback, options) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push({ callback: callback, once: !!(options && options.once) });
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    this.listeners.set(type, callbacks.filter(function (entry) {
      return entry.callback !== callback;
    }));
  }

  dispatch(type) {
    const callbacks = (this.listeners.get(type) || []).slice();
    callbacks.forEach((entry) => {
      entry.callback();
      if (entry.once) this.removeEventListener(type, entry.callback);
    });
  }
}

function createEnvironment(options) {
  const settings = options || {};
  const createdScripts = [];
  const performanceEntries = settings.performanceEntries || [];
  const existingScript = settings.existingScript || null;

  const document = {
    querySelector: function () {
      return existingScript;
    },
    createElement: function (tagName) {
      assert.equal(tagName, "script");
      return new FakeScript();
    },
    head: {
      appendChild: function (script) {
        createdScripts.push(script);
      }
    }
  };

  const window = {
    performance: {
      getEntriesByName: function (name) {
        return performanceEntries.filter(function (entry) {
          return entry.name === name;
        });
      }
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };

  vm.runInNewContext(MODULE_LOADER_SOURCE, {
    window: window,
    document: document,
    Promise: Promise,
    String: String,
    Error: Error,
    Object: Object
  });

  return {
    createdScripts: createdScripts,
    window: window
  };
}

function moduleConfig() {
  return {
    globalName: "ExampleModule",
    selector: 'script[src^="/example_module.js"]',
    src: "/example_module.js?v=1",
    missingMessage: "ExampleModule ausente.",
    loadErrorMessage: "ExampleModule falhou ao carregar."
  };
}

test("rejects when an existing script already completed without exposing its global", async function () {
  const script = new FakeScript("https://teacherflavius.com/example_module.js?v=1");
  script.readyState = "complete";
  const environment = createEnvironment({ existingScript: script });

  await assert.rejects(
    environment.window.ModuleLoader.loadGlobalModule(moduleConfig()),
    /ExampleModule ausente\./
  );
});

test("rejects a completed existing script detected through Resource Timing", async function () {
  const script = new FakeScript("https://teacherflavius.com/example_module.js?v=1");
  const environment = createEnvironment({
    existingScript: script,
    performanceEntries: [{ name: script.src, initiatorType: "script" }]
  });

  await assert.rejects(
    environment.window.ModuleLoader.loadGlobalModule(moduleConfig()),
    /ExampleModule ausente\./
  );
});

test("keeps waiting for an existing script that is still loading", async function () {
  const script = new FakeScript("https://teacherflavius.com/example_module.js?v=1");
  const environment = createEnvironment({ existingScript: script });
  const promise = environment.window.ModuleLoader.loadGlobalModule(moduleConfig());
  let settled = false;
  promise.then(
    function () { settled = true; },
    function () { settled = true; }
  );

  await new Promise(function (resolve) {
    setTimeout(resolve, 5);
  });
  assert.equal(settled, false);

  const module = { ready: true };
  environment.window.ExampleModule = module;
  script.dispatch("load");

  assert.equal(await promise, module);
});

test("creates a missing script and resolves it on load", async function () {
  const environment = createEnvironment();
  const promise = environment.window.ModuleLoader.loadGlobalModule(moduleConfig());

  assert.equal(environment.createdScripts.length, 1);
  const script = environment.createdScripts[0];
  assert.equal(script.src, "/example_module.js?v=1");
  assert.equal(script.async, true);

  const module = { ready: true };
  environment.window.ExampleModule = module;
  script.dispatch("load");

  assert.equal(await promise, module);
});

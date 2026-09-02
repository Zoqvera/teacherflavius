const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAssetLoader(existingById) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "site_asset_loader.js"),
    "utf8"
  );
  const appended = [];
  const elements = Object.assign({}, existingById || {});
  const document = {
    getElementById: function (id) {
      return elements[id] || null;
    },
    createElement: function (tagName) {
      return { tagName: tagName };
    },
    head: {
      appendChild: function (element) {
        appended.push(element);
        if (element.id) elements[element.id] = element;
      }
    }
  };
  const context = {
    document: document,
    window: {}
  };

  vm.runInNewContext(source, context);
  return {
    loader: context.window.SiteAssetLoader,
    appended: appended,
    elements: elements
  };
}

test("calls script callback immediately when asset already exists", function () {
  let calls = 0;
  const runtime = loadAssetLoader({ existing-script: { id: "existing-script" } });

  runtime.loader.loadScript("existing-script", "/existing.js", function () {
    calls += 1;
  });

  assert.equal(calls, 1);
  assert.equal(runtime.appended.length, 0);
});

test("creates ordered script and preserves load/error callback contract", function () {
  let calls = 0;
  const runtime = loadAssetLoader();

  runtime.loader.loadScriptAsset(
    { id: "new-script", src: "/new.js" },
    function () {
      calls += 1;
    }
  );

  assert.equal(runtime.appended.length, 1);
  const script = runtime.appended[0];
  assert.equal(script.tagName, "script");
  assert.equal(script.id, "new-script");
  assert.equal(script.src, "/new.js");
  assert.equal(script.async, false);
  assert.equal(script.onload, script.onerror);

  script.onload();
  assert.equal(calls, 1);
});

test("creates stylesheet once from asset descriptor", function () {
  const runtime = loadAssetLoader();
  const asset = { id: "site-style", href: "/site.css" };

  runtime.loader.loadStylesheetAsset(asset);
  runtime.loader.loadStylesheetAsset(asset);

  assert.equal(runtime.appended.length, 1);
  const stylesheet = runtime.appended[0];
  assert.equal(stylesheet.tagName, "link");
  assert.equal(stylesheet.id, "site-style");
  assert.equal(stylesheet.rel, "stylesheet");
  assert.equal(stylesheet.href, "/site.css");
});

test("exposes immutable public loader API", function () {
  const runtime = loadAssetLoader();

  assert.equal(Object.isFrozen(runtime.loader), true);
  assert.equal(typeof runtime.loader.loadScript, "function");
  assert.equal(typeof runtime.loader.loadScriptAsset, "function");
  assert.equal(typeof runtime.loader.loadStylesheet, "function");
  assert.equal(typeof runtime.loader.loadStylesheetAsset, "function");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAssetLoader(existingById) {
  const source = fs.readFileSync(path.join(__dirname, "..", "site_asset_loader.js"), "utf8");
  const appended = [];
  const scheduled = [];
  const elements = Object.assign({}, existingById || {});
  const document = {
    getElementById: function (id) { return elements[id] || null; },
    createElement: function (tagName) {
      return {
        tagName: tagName,
        remove: function () { delete elements[this.id]; }
      };
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
    window: {
      setTimeout: function (callback, delay) { scheduled.push({ callback, delay }); }
    }
  };

  vm.runInNewContext(source, context);
  return {
    loader: context.window.SiteAssetLoader,
    appended: appended,
    elements: elements,
    scheduled: scheduled,
    runRetry: function () { scheduled.shift().callback(); }
  };
}

test("calls script callback immediately when asset already exists", function () {
  let calls = 0;
  const runtime = loadAssetLoader({ "existing-script": { id: "existing-script" } });
  runtime.loader.loadScript("existing-script", "/existing.js", function () { calls += 1; });
  assert.equal(calls, 1);
  assert.equal(runtime.appended.length, 0);
});

test("creates an ordered script and notifies after successful loading", function () {
  let calls = 0;
  const runtime = loadAssetLoader();
  runtime.loader.loadScriptAsset({ id: "new-script", src: "/new.js" }, function () { calls += 1; });
  const script = runtime.appended[0];
  assert.equal(script.tagName, "script");
  assert.equal(script.id, "new-script");
  assert.equal(script.src, "/new.js");
  assert.equal(script.async, false);
  assert.notEqual(script.onload, script.onerror);
  script.onload();
  assert.equal(calls, 1);
});

test("retries local scripts once and waits to run dependent callbacks", function () {
  let calls = 0;
  const runtime = loadAssetLoader();
  runtime.loader.loadScript("part", "/part.js", function () { calls += 1; });
  runtime.loader.loadScript("part", "/part.js", function () { calls += 1; });
  assert.equal(runtime.appended.length, 1);
  runtime.appended[0].onerror();
  assert.equal(calls, 0);
  assert.equal(runtime.scheduled.length, 1);
  assert.equal(runtime.scheduled[0].delay, 600);
  runtime.runRetry();
  assert.equal(runtime.appended.length, 2);
  runtime.appended[1].onload();
  assert.equal(calls, 2);
});

test("stops after one unsuccessful retry and preserves callback fallback", function () {
  let calls = 0;
  const runtime = loadAssetLoader();
  runtime.loader.loadScript("local", "/local.js", function () { calls += 1; });
  runtime.appended[0].onerror();
  runtime.runRetry();
  runtime.appended[1].onerror();
  assert.equal(calls, 1);
  assert.equal(runtime.scheduled.length, 0);
  assert.equal(runtime.elements.local, undefined);
});

test("does not retry third-party scripts", function () {
  let calls = 0;
  const runtime = loadAssetLoader();
  runtime.loader.loadScript("external", "https://cdn.example.test/script.js", function () { calls += 1; });
  runtime.appended[0].onerror();
  assert.equal(calls, 1);
  assert.equal(runtime.scheduled.length, 0);
});

test("creates a stylesheet once and retries only local stylesheet failures", function () {
  const runtime = loadAssetLoader();
  const asset = { id: "site-style", href: "/site.css" };
  runtime.loader.loadStylesheetAsset(asset);
  runtime.loader.loadStylesheetAsset(asset);
  assert.equal(runtime.appended.length, 1);
  const stylesheet = runtime.appended[0];
  assert.equal(stylesheet.tagName, "link");
  assert.equal(stylesheet.rel, "stylesheet");
  assert.equal(stylesheet.href, "/site.css");
  stylesheet.onerror();
  runtime.runRetry();
  assert.equal(runtime.appended.length, 2);
  runtime.appended[1].onerror();
  assert.equal(runtime.scheduled.length, 0);
});

test("exposes an immutable public loader API", function () {
  const runtime = loadAssetLoader();
  assert.equal(Object.isFrozen(runtime.loader), true);
  assert.equal(typeof runtime.loader.loadScript, "function");
  assert.equal(typeof runtime.loader.loadScriptAsset, "function");
  assert.equal(typeof runtime.loader.loadStylesheet, "function");
  assert.equal(typeof runtime.loader.loadStylesheetAsset, "function");
});

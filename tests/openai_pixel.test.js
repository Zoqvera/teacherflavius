const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createRuntime() {
  const insertedScripts = [];
  const firstScript = {
    parentNode: {
      insertBefore: function (script) {
        insertedScripts.push(script);
      }
    }
  };
  const document = {
    head: {
      appendChild: function (script) {
        insertedScripts.push(script);
      }
    },
    createElement: function () {
      return {};
    },
    getElementsByTagName: function () {
      return [firstScript];
    }
  };
  const window = {};

  return {
    context: { window: window, document: document },
    insertedScripts: insertedScripts,
    window: window
  };
}

function readSource() {
  return fs.readFileSync(
    path.join(__dirname, "..", "openai_pixel.js"),
    "utf8"
  );
}

test("initializes the OpenAI Pixel queue and SDK once", function () {
  const runtime = createRuntime();
  const source = readSource();

  vm.runInNewContext(source, runtime.context);

  assert.equal(typeof runtime.window.oaiq, "function");
  assert.equal(runtime.insertedScripts.length, 1);
  assert.equal(runtime.insertedScripts[0].async, true);
  assert.equal(
    runtime.insertedScripts[0].src,
    "https://bzrcdn.openai.com/sdk/oaiq.min.js"
  );

  assert.equal(runtime.window.oaiq.q.length, 1);
  assert.equal(runtime.window.oaiq.q[0][0], "init");
  assert.equal(runtime.window.oaiq.q[0][1].pixelId, "LaRJuEgBCtVnHSv4Ca4uur");
  assert.equal(runtime.window.oaiq.q[0][1].debug, true);

  vm.runInNewContext(source, runtime.context);
  assert.equal(runtime.insertedScripts.length, 1);
  assert.equal(runtime.window.oaiq.q.length, 1);
});

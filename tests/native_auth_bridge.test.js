const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "native_auth_bridge.js"), "utf8");

function execute(options) {
  const settings = options || {};
  const handlers = {};
  const replaced = [];
  const assigned = [];
  const browserCalls = [];

  const plugins = {
    App: {
      addListener: function (name, handler) {
        handlers[name] = handler;
        return Promise.resolve({ remove: function () {} });
      },
      getLaunchUrl: function () {
        return Promise.resolve(settings.launchUrl ? { url: settings.launchUrl } : null);
      }
    },
    Browser: {
      open: function (options) {
        browserCalls.push({ action: "open", options: options });
        return Promise.resolve();
      },
      close: function () {
        browserCalls.push({ action: "close" });
        return Promise.resolve();
      }
    }
  };

  const windowRef = {
    Capacitor: {
      isNativePlatform: function () { return settings.native !== false; },
      Plugins: plugins
    },
    location: {
      replace: function (value) { replaced.push(value); },
      assign: function (value) { assigned.push(value); }
    },
    URL: URL,
    URLSearchParams: URLSearchParams
  };

  const context = {
    window: windowRef,
    URL: URL,
    URLSearchParams: URLSearchParams,
    console: { warn: function () {} },
    Promise: Promise
  };

  vm.runInNewContext(SOURCE, context);

  return {
    api: windowRef.TeacherFlaviusNativeAuth,
    assigned: assigned,
    browserCalls: browserCalls,
    handlers: handlers,
    replaced: replaced,
    windowRef: windowRef
  };
}

test("parses only the configured OAuth callback", function () {
  const result = execute();
  const callback = result.api.parseCallbackUrl(
    "com.teacherflavius.app://login-callback?code=abc&next=%2Farea-do-estudante%2F"
  );

  assert.equal(callback.code, "abc");
  assert.equal(callback.nextPath, "/area-do-estudante/index.html");
  assert.equal(result.api.parseCallbackUrl("https://teacherflavius.com/login/"), null);
});

test("returns a native OAuth callback to the local login page", async function () {
  const result = execute();

  const handled = await result.api.handleCallbackUrl(
    "com.teacherflavius.app://login-callback?code=secure-code&next=%2Farea-do-estudante%2F",
    result.windowRef
  );

  assert.equal(handled, true);
  assert.equal(result.browserCalls[0].action, "close");
  assert.equal(result.replaced.length, 1);
  assert.match(result.replaced[0], /^\/login\/\?/);
  assert.match(result.replaced[0], /native_code=secure-code/);
  assert.match(result.replaced[0], /area-do-estudante%2Findex\.html/);
});

test("opens OAuth URL through the native Browser plugin", async function () {
  const result = execute();

  await result.api.openOAuthUrl("https://example.test/oauth", result.windowRef);

  const openCall = result.browserCalls.find(function (item) {
    return item.action === "open";
  });
  assert.equal(openCall.options.url, "https://example.test/oauth");
  assert.equal(result.assigned.length, 0);
});

test("does not initialize native listeners on the web", function () {
  const result = execute({ native: false });
  assert.equal(result.api.isNativeApp(result.windowRef), false);
  assert.equal(Object.keys(result.handlers).length, 0);
});

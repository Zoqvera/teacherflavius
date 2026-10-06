const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "pwa_registration.js"), "utf8");

function execute(options) {
  const settings = options || {};
  const registrations = [];
  const handlers = new Map();
  const dispatchedEvents = [];
  const storageValues = new Map(Object.entries(settings.storage || {}));
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

  if (settings.relatedApps) {
    navigatorRef.getInstalledRelatedApps = function () {
      return Promise.resolve(settings.relatedApps);
    };
  }

  const windowRef = {
    navigator: navigatorRef,
    localStorage: {
      getItem: function (key) {
        return storageValues.has(key) ? storageValues.get(key) : null;
      },
      setItem: function (key, value) {
        storageValues.set(key, String(value));
      },
      removeItem: function (key) {
        storageValues.delete(key);
      }
    },
    Capacitor: settings.native === true
      ? { isNativePlatform: function () { return true; } }
      : undefined,
    Event: function Event(type) { this.type = type; },
    matchMedia: function () { return { matches: settings.standalone === true }; },
    addEventListener: function (eventName, handler) {
      if (!handlers.has(eventName)) handlers.set(eventName, []);
      handlers.get(eventName).push(handler);
      if (eventName === "load") loadHandler = handler;
    },
    dispatchEvent: function (event) {
      dispatchedEvents.push(event.type);
      (handlers.get(event.type) || []).forEach(function (handler) { handler(event); });
      return true;
    }
  };

  const context = {
    window: windowRef,
    document: { readyState: settings.readyState || "complete" },
    console: { warn: function () {} },
    Promise: Promise
  };

  vm.runInNewContext(SOURCE, context);

  function emit(eventName, event) {
    (handlers.get(eventName) || []).forEach(function (handler) { handler(event || { type: eventName }); });
  }

  return {
    api: windowRef.TeacherFlaviusPwa,
    dispatchedEvents: dispatchedEvents,
    emit: emit,
    load: function () { if (loadHandler) loadHandler(); },
    registrations: registrations,
    storageValues: storageValues,
    windowRef: windowRef
  };
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

test("does not register the web service worker inside Capacitor native apps", function () {
  const result = execute({ native: true });
  assert.equal(result.api.isNativeCapacitorApp(result.windowRef), true);
  assert.equal(result.registrations.length, 0);
  assert.equal(result.api.canPromptInstall(result.windowRef), false);
});

test("waits for window load while the document is still loading", function () {
  const result = execute({ readyState: "loading" });
  assert.equal(result.registrations.length, 0);
  result.load();
  assert.equal(result.registrations.length, 1);
});

test("captures the browser install prompt and exposes availability", function () {
  const result = execute();
  let prevented = false;

  result.emit("beforeinstallprompt", {
    preventDefault: function () { prevented = true; },
    prompt: function () { return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "accepted" })
  });

  assert.equal(prevented, true);
  assert.equal(result.api.canPromptInstall(result.windowRef), true);
  assert.equal(
    result.dispatchedEvents.includes(result.api.installAvailabilityEvent),
    true
  );
});

test("does not expose install prompt in standalone display mode", function () {
  const result = execute({ standalone: true });
  result.emit("beforeinstallprompt", {
    preventDefault: function () {},
    prompt: function () { return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "accepted" })
  });

  assert.equal(result.api.isStandalone(result.windowRef), true);
  assert.equal(result.api.canPromptInstall(result.windowRef), false);
});

test("requests installation once and clears the deferred prompt", async function () {
  const result = execute();
  let promptCalls = 0;

  result.emit("beforeinstallprompt", {
    preventDefault: function () {},
    prompt: function () { promptCalls += 1; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "accepted" })
  });

  const choice = await result.api.requestInstall(result.windowRef);

  assert.equal(promptCalls, 1);
  assert.equal(choice.outcome, "accepted");
  assert.equal(result.api.canPromptInstall(result.windowRef), false);
});


test("records installation when the browser confirms app installation", function () {
  const result = execute();

  result.emit("appinstalled");

  assert.equal(result.api.isInstalled(result.windowRef), true);
  assert.equal(
    result.storageValues.get("teacherflavius:pwa-installed"),
    "1"
  );
});

test("records installation after an accepted install prompt", async function () {
  const result = execute();

  result.emit("beforeinstallprompt", {
    preventDefault: function () {},
    prompt: function () { return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "accepted" })
  });

  const choice = await result.api.requestInstall(result.windowRef);

  assert.equal(choice.outcome, "accepted");
  assert.equal(result.api.isInstalled(result.windowRef), true);
  assert.equal(
    result.storageValues.get("teacherflavius:pwa-installed"),
    "1"
  );
});

test("recognizes a previously installed PWA on later browser visits", function () {
  const result = execute({
    storage: { "teacherflavius:pwa-installed": "1" }
  });

  assert.equal(result.api.isInstalled(result.windowRef), true);
  assert.equal(result.api.canPromptInstall(result.windowRef), false);
});

test("standalone launch records installation for future browser visits", function () {
  const result = execute({ standalone: true });

  assert.equal(result.api.isInstalled(result.windowRef), true);
  assert.equal(
    result.storageValues.get("teacherflavius:pwa-installed"),
    "1"
  );
});

test("a new beforeinstallprompt event clears a stale installed marker", function () {
  const result = execute({
    storage: { "teacherflavius:pwa-installed": "1" }
  });

  result.emit("beforeinstallprompt", {
    preventDefault: function () {},
    prompt: function () { return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: "dismissed" })
  });

  assert.equal(result.storageValues.has("teacherflavius:pwa-installed"), false);
  assert.equal(result.api.canPromptInstall(result.windowRef), true);
});


test("detects a previously installed PWA through related apps", async function () {
  const result = execute({
    relatedApps: [
      {
        platform: "webapp",
        id: "https://teacherflavius.com/",
        url: "/site.webmanifest"
      }
    ]
  });

  const installed = await result.api.refreshInstalledState(result.windowRef);

  assert.equal(installed, true);
  assert.equal(result.api.isInstalled(result.windowRef), true);
  assert.equal(
    result.storageValues.get("teacherflavius:pwa-installed"),
    "1"
  );
});

test("ignores unrelated installed applications", async function () {
  const result = execute({
    relatedApps: [
      {
        platform: "play",
        id: "com.example.other"
      }
    ]
  });

  const installed = await result.api.refreshInstalledState(result.windowRef);

  assert.equal(installed, false);
  assert.equal(result.api.isInstalled(result.windowRef), false);
});

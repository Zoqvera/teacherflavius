const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "pwa_install_prompt.js"), "utf8");

function execute(options) {
  const settings = options || {};
  const handlers = new Map();
  const card = { hidden: true };
  const buttonHandlers = new Map();
  const button = {
    disabled: false,
    addEventListener: function (name, handler) { buttonHandlers.set(name, handler); }
  };

  const api = {
    installAvailabilityEvent: "teacherflavius:pwa-install-availability",
    canPromptInstall: function () { return settings.available === true; },
    isStandalone: function () { return settings.standalone === true; },
    requestInstall: async function () {
      if (typeof settings.onRequest === "function") settings.onRequest();
      return { outcome: "accepted" };
    }
  };

  const windowRef = {
    TeacherFlaviusPwa: api,
    addEventListener: function (name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    }
  };

  const documentRef = {
    getElementById: function (id) {
      if (id === "pwaInstallCard") return card;
      if (id === "pwaInstallButton") return button;
      return null;
    }
  };

  const context = {
    window: windowRef,
    document: documentRef,
    Promise: Promise
  };

  vm.runInNewContext(SOURCE, context);

  return {
    api: windowRef.TeacherFlaviusPwaInstallPrompt,
    button: button,
    card: card,
    click: async function () {
      const handler = buttonHandlers.get("click");
      if (handler) await handler();
      await Promise.resolve();
    },
    emitAvailability: function () {
      (handlers.get(api.installAvailabilityEvent) || []).forEach(function (handler) { handler(); });
    },
    windowRef: windowRef,
    documentRef: documentRef
  };
}

test("shows install card only when the PWA prompt is available", function () {
  const available = execute({ available: true });
  available.api.initialize(available.windowRef, available.documentRef);
  assert.equal(available.card.hidden, false);

  const unavailable = execute({ available: false });
  unavailable.api.initialize(unavailable.windowRef, unavailable.documentRef);
  assert.equal(unavailable.card.hidden, true);
});

test("keeps install card hidden in standalone mode", function () {
  const result = execute({ available: true, standalone: true });
  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, true);
});

test("requests installation from the browser when button is clicked", async function () {
  let requests = 0;
  const result = execute({
    available: true,
    onRequest: function () { requests += 1; }
  });

  result.api.initialize(result.windowRef, result.documentRef);
  await result.click();

  assert.equal(requests, 1);
  assert.equal(result.button.disabled, false);
});

test("reacts to install availability changes", function () {
  const settings = { available: false };
  const result = execute(settings);
  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, true);

  settings.available = true;
  result.emitAvailability();
  assert.equal(result.card.hidden, false);
});

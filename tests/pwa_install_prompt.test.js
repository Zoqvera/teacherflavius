const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "pwa_install_prompt.js"), "utf8");

function execute(options) {
  const settings = options || {};
  const handlers = new Map();
  const card = { hidden: false };
  const buttonHandlers = new Map();
  const alerts = [];
  const button = {
    disabled: false,
    addEventListener: function (name, handler) { buttonHandlers.set(name, handler); }
  };

  const api = {
    installAvailabilityEvent: "teacherflavius:pwa-install-availability",
    canPromptInstall: function () { return settings.available === true; },
    isInstalled: function () {
      return settings.installed === true ||
        settings.standalone === true ||
        settings.native === true;
    },
    isStandalone: function () { return settings.standalone === true; },
    isNativeCapacitorApp: function () { return settings.native === true; },
    requestInstall: async function () {
      if (typeof settings.onRequest === "function") settings.onRequest();
      return { outcome: settings.outcome || "accepted" };
    }
  };

  if (settings.refreshInstalledState) {
    api.refreshInstalledState = async function () {
      if (typeof settings.onRefreshInstalledState === "function") {
        await settings.onRefreshInstalledState();
      }
      settings.installed = settings.refreshInstalledState === true;
      return settings.installed;
    };
  }

  const windowRef = {
    TeacherFlaviusPwa: api,
    navigator: settings.navigator || {},
    alert: function (message) { alerts.push(message); },
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
    alerts: alerts,
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
    emitAppInstalled: function () {
      (handlers.get("appinstalled") || []).forEach(function (handler) { handler(); });
    },
    windowRef: windowRef,
    documentRef: documentRef
  };
}

test("keeps install card visible before the PWA has been installed", function () {
  const available = execute({ available: true });
  available.api.initialize(available.windowRef, available.documentRef);
  assert.equal(available.card.hidden, false);

  const unavailable = execute({ available: false });
  unavailable.api.initialize(unavailable.windowRef, unavailable.documentRef);
  assert.equal(unavailable.card.hidden, false);
});

test("keeps install card hidden after installation and in app modes", function () {
  const installed = execute({ installed: true });
  installed.api.initialize(installed.windowRef, installed.documentRef);
  assert.equal(installed.card.hidden, true);

  const standalone = execute({ standalone: true });
  standalone.api.initialize(standalone.windowRef, standalone.documentRef);
  assert.equal(standalone.card.hidden, true);

  const native = execute({ native: true });
  native.api.initialize(native.windowRef, native.documentRef);
  assert.equal(native.card.hidden, true);
});

test("requests installation from the browser when the prompt is available", async function () {
  let requests = 0;
  const result = execute({
    available: true,
    onRequest: function () { requests += 1; }
  });

  result.api.initialize(result.windowRef, result.documentRef);
  await result.click();

  assert.equal(requests, 1);
  assert.equal(result.alerts.length, 0);
  assert.equal(result.button.disabled, false);
});

test("shows manual installation instructions when browser prompt is unavailable", async function () {
  const result = execute({ available: false });

  result.api.initialize(result.windowRef, result.documentRef);
  await result.click();

  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0], /Instalar app|Adicionar à tela inicial/);
});

test("uses Safari-specific instructions on Apple mobile devices", async function () {
  const result = execute({
    available: false,
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }
  });

  result.api.initialize(result.windowRef, result.documentRef);
  await result.click();

  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0], /Safari/);
  assert.match(result.alerts[0], /Adicionar à Tela de Início/);
});

test("remains visible when install prompt availability changes", function () {
  const settings = { available: false };
  const result = execute(settings);
  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, false);

  settings.available = true;
  result.emitAvailability();
  assert.equal(result.card.hidden, false);
});


test("hides install card immediately when installation completes", function () {
  const settings = { available: true, installed: false };
  const result = execute(settings);
  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, false);

  settings.installed = true;
  result.emitAppInstalled();

  assert.equal(result.card.hidden, true);
});

test("hides install card when persisted installation state becomes available", function () {
  const settings = { available: false, installed: false };
  const result = execute(settings);
  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, false);

  settings.installed = true;
  result.emitAvailability();

  assert.equal(result.card.hidden, true);
});


test("keeps card hidden until installed-state verification completes", async function () {
  let resolveRefresh;
  const refreshPromise = new Promise(function (resolve) {
    resolveRefresh = resolve;
  });
  const settings = {
    refreshInstalledState: true,
    onRefreshInstalledState: function () {
      return refreshPromise;
    }
  };
  const result = execute(settings);

  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, true);

  resolveRefresh();
  await refreshPromise;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(result.card.hidden, true);
});

test("reveals card only after verification confirms the PWA is not installed", async function () {
  const settings = { refreshInstalledState: false };
  const result = execute(settings);
  result.api.refreshInstalledState = async function () {
    settings.installed = false;
    return false;
  };

  result.api.initialize(result.windowRef, result.documentRef);
  assert.equal(result.card.hidden, true);

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(result.card.hidden, false);
});

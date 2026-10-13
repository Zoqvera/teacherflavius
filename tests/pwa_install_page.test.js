const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "instalar-app", "index.html"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "instalar-app", "app.js"), "utf8");

test("install page is a public PWA entrypoint", function () {
  assert.match(page, /href="\/site\.webmanifest"/);
  assert.match(page, /src="\/pwa_registration\.js/);
  assert.match(page, /id="installAppButton"/);
  assert.doesNotMatch(page, /auth\.js/);
});

test("install page remains outside search indexing", function () {
  assert.match(page, /name="robots" content="noindex, nofollow"/);
  assert.match(page, /rel="canonical" href="https:\/\/teacherflavius\.com\/instalar-app\/"/);
});

test("install controller requests the browser-native PWA prompt", function () {
  assert.match(script, /api\.canPromptInstall/);
  assert.match(script, /api\.requestInstall/);
  assert.match(script, /result\.outcome === "accepted"/);
});

test("install controller provides manual fallbacks", function () {
  assert.match(script, /Adicionar à Tela de Início/);
  assert.match(script, /Instalar aplicativo ou Adicionar à tela inicial/);
  assert.match(script, /appinstalled/);
});


const vm = require("node:vm");

function renderInstallPage(options) {
  const settings = options || {};
  const listeners = new Map();
  const label = { textContent: "INSTALAR APP" };
  const button = {
    disabled: true,
    querySelector: function () { return label; },
    addEventListener: function (name, listener) { listeners.set(name, listener); }
  };
  const status = { textContent: "" };
  const instructions = {
    hidden: true,
    focused: false,
    focus: function () { this.focused = true; }
  };
  const instructionsText = { textContent: "" };
  const elements = {
    installAppButton: button,
    installStatus: status,
    manualInstructions: instructions,
    manualInstructionsText: instructionsText
  };
  const api = {
    isStandalone: function () { return settings.standalone === true; },
    canPromptInstall: function () { return settings.available === true; },
    installAvailabilityEvent: "teacherflavius:pwa-install-availability",
    requestInstall: async function () {
      if (typeof settings.onInstall === "function") settings.onInstall();
      return { outcome: settings.outcome || "accepted" };
    }
  };
  const windowRef = {
    navigator: settings.navigator || {},
    TeacherFlaviusPwa: settings.missingApi ? undefined : api,
    addEventListener: function () {}
  };
  const documentRef = {
    readyState: "complete",
    getElementById: function (id) { return elements[id] || null; }
  };
  vm.runInNewContext(script, { window: windowRef, document: documentRef, Promise: Promise });

  return {
    button: button,
    label: label,
    status: status,
    instructions: instructions,
    instructionsText: instructionsText,
    click: function () { listeners.get("click")(); }
  };
}

test("manual installation remains actionable without a browser install prompt", function () {
  const result = renderInstallPage({
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }
  });

  assert.equal(result.button.disabled, false);
  assert.equal(result.label.textContent, "VER COMO INSTALAR");
  assert.equal(result.instructions.hidden, false);
  assert.match(result.instructionsText.textContent, /Safari/);
  assert.match(result.instructionsText.textContent, /Adicionar à Tela de Início/);

  result.click();
  assert.equal(result.instructions.focused, true);
  assert.match(result.status.textContent, /Siga as instruções/);
});

test("embedded browsers show an external-browser fallback", function () {
  const result = renderInstallPage({
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 15; wv) WhatsApp/2.26" }
  });

  assert.equal(result.button.disabled, false);
  assert.match(result.instructionsText.textContent, /Google Chrome/);
  assert.match(result.instructionsText.textContent, /Abra esta página/);
});

test("missing browser install API does not disable manual installation", function () {
  const result = renderInstallPage({ missingApi: true });
  assert.equal(result.button.disabled, false);
  result.click();
  assert.equal(result.instructions.focused, true);
});

test("browser install prompt remains available when supported", async function () {
  let requests = 0;
  const result = renderInstallPage({
    available: true,
    onInstall: function () { requests += 1; }
  });

  assert.equal(result.button.disabled, false);
  assert.equal(result.label.textContent, "INSTALAR APP");
  assert.equal(result.instructions.hidden, true);
  result.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.match(result.status.textContent, /Instalação iniciada/);
});

test("failed browser installation returns to actionable instructions", async function () {
  const result = renderInstallPage({ available: true, outcome: "error" });
  result.click();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(result.button.disabled, false);
  assert.equal(result.instructions.hidden, false);
  assert.match(result.status.textContent, /Não foi possível/);
});

test("standalone PWA does not offer another installation", function () {
  const result = renderInstallPage({ standalone: true });
  assert.equal(result.button.disabled, true);
  assert.equal(result.label.textContent, "APP JÁ INSTALADO");
});

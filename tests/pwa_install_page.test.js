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

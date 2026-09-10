const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSiteWhatsapp() {
  const source = fs.readFileSync(path.join(__dirname, "..", "site_whatsapp.js"), "utf8");
  const window = {};
  const context = vm.createContext({
    window: window,
    document: {},
    MutationObserver: function () {},
    URL: URL,
    encodeURIComponent: encodeURIComponent
  });

  vm.runInContext(source, context);
  return window.SiteWhatsapp;
}

test("buildUrl normalizes a phone and preserves the default message", function () {
  const siteWhatsapp = loadSiteWhatsapp();
  const url = new URL(siteWhatsapp.buildUrl("+55 (34) 99834-9756"));

  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/5534998349756");
  assert.equal(
    url.searchParams.get("text"),
    "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês."
  );
});

test("buildUrl returns an empty string when no phone digits are available", function () {
  const siteWhatsapp = loadSiteWhatsapp();
  assert.equal(siteWhatsapp.buildUrl("sem telefone"), "");
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadSiteWhatsapp() {
  const source = fs.readFileSync(path.join(__dirname, "..", "site_whatsapp.js"), "utf8");
  const window = {
    location: { href: "https://teacherflavius.com/aulas-experimentais/" }
  };
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

function createWhatsappLink(href, isTrialLessonLink) {
  let currentHref = href;
  return {
    getAttribute: function (name) {
      return name === "href" ? currentHref : null;
    },
    matches: function (selector) {
      return selector === ".trial-whatsapp-link" && isTrialLessonLink;
    },
    get href() {
      return currentHref;
    },
    set href(value) {
      currentHref = value;
    }
  };
}

function standardizeSingleLink(siteWhatsapp, link) {
  siteWhatsapp.standardizeLinks({
    querySelectorAll: function () {
      return [link];
    }
  });
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

test("trial lesson WhatsApp link receives only the confirmation message", function () {
  const siteWhatsapp = loadSiteWhatsapp();
  const link = createWhatsappLink("https://wa.me/5521969086260", true);

  standardizeSingleLink(siteWhatsapp, link);

  assert.equal(
    new URL(link.href).searchParams.get("text"),
    "Olá! Você tem uma aula experimental agendada. Você confirma sua participação?"
  );
});

test("other WhatsApp links keep the existing default message", function () {
  const siteWhatsapp = loadSiteWhatsapp();
  const link = createWhatsappLink("https://wa.me/5534998349756", false);

  standardizeSingleLink(siteWhatsapp, link);

  assert.equal(
    new URL(link.href).searchParams.get("text"),
    "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês."
  );
});

test("buildUrl returns an empty string when no phone digits are available", function () {
  const siteWhatsapp = loadSiteWhatsapp();
  assert.equal(siteWhatsapp.buildUrl("sem telefone"), "");
});

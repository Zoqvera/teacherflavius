const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const navigation = fs.readFileSync(path.join(ROOT, "mobile_top_navigation.js"), "utf8");

test("restricted-page fallback contains only restricted destinations", function () {
  const start = navigation.indexOf("var RESTRICTED_FALLBACK_LINKS");
  const end = navigation.indexOf("var MENU_ICON_SVG", start);
  assert.ok(start >= 0 && end > start);

  const restrictedFallback = navigation.slice(start, end);
  assert.match(restrictedFallback, /\/area-do-estudante\//);
  assert.match(restrictedFallback, /\/area-do-estudante\/minhas-aulas\//);
  assert.match(restrictedFallback, /\/o-que-fazer\//);
  assert.match(restrictedFallback, /\/perfil\//);
  assert.doesNotMatch(restrictedFallback, /href:\s*"\/"\s*,/);
  assert.doesNotMatch(restrictedFallback, /\/aulas-em-grupo\//);
  assert.doesNotMatch(restrictedFallback, /\/aulas-individuais\//);
});

test("restricted menus reject public, access-flow and external links", function () {
  assert.match(navigation, /function isRestrictedCurrentPage\(\)/);
  assert.match(navigation, /function isRestrictedDestination\(action\)/);
  assert.match(navigation, /if \(url\.origin !== window\.location\.origin\) return false/);
  assert.match(navigation, /function isRestrictedPath\(pathname\)/);
  assert.match(navigation, /return isRestrictedPath\(url\.pathname\)/);
  assert.match(navigation, /path\.indexOf\("\/aulas-em-grupo"\) === 0/);
  assert.match(navigation, /path\.indexOf\("\/instalar-app"\) === 0/);
  assert.match(navigation, /return isRestrictedDestination\(action\)/);
});

test("public pages keep their existing public fallback navigation", function () {
  assert.match(navigation, /var PUBLIC_FALLBACK_LINKS/);
  assert.match(navigation, /href: "\/", label: "HOME"/);
  assert.match(navigation, /href: "\/aulas-em-grupo\/", label: "AULAS EM GRUPO"/);
  assert.match(navigation, /href: "\/aulas-individuais\/", label: "AULAS INDIVIDUAIS"/);
  assert.match(
    navigation,
    /return isRestrictedCurrentPage\(\) \? RESTRICTED_FALLBACK_LINKS : PUBLIC_FALLBACK_LINKS/
  );
});

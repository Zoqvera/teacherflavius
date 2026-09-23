const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const navigation = fs.readFileSync(path.join(root, "mobile_top_navigation.js"), "utf8");
const runtimeConfig = fs.readFileSync(path.join(root, "site_runtime_config.js"), "utf8");
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const studentArea = fs.readFileSync(path.join(root, "area_do_estudante.html"), "utf8");
const myClass = fs.readFileSync(path.join(root, "minha_turma.html"), "utf8");
const profileStudents = fs.readFileSync(path.join(root, "perfil_dos_alunos.html"), "utf8");

test("uses the profile-students menu pattern as the global navigation model", function () {
  assert.equal(profileStudents.includes('class="top-links"'), true);
  assert.equal(navigation.includes("SOURCE_SELECTORS"), true);
  assert.equal(navigation.includes('".top-links"'), true);
  assert.equal(navigation.includes("tf-mobile-top-menu-overlay"), true);
  assert.equal(navigation.includes("tf-mobile-nav-toggle"), true);
});

test("creates a standardized fallback menu when a page has no navigation source", function () {
  assert.equal(navigation.includes("FALLBACK_SOURCE_ID"), true);
  assert.equal(navigation.includes("ensureNavigationSource"), true);
  assert.equal(navigation.includes("actionCount >= 1"), true);
  assert.equal(navigation.includes('href: "/aulas-em-grupo/"'), true);
  assert.equal(navigation.includes('href: "/aulas-individuais/"'), true);
  assert.equal(navigation.includes('href: "/area-do-estudante/"'), true);
});

test("uses SVG controls rather than character icons", function () {
  assert.match(navigation, /MENU_ICON_SVG/);
  assert.match(navigation, /CLOSE_ICON_SVG/);
  assert.match(navigation, /ARROW_ICON_SVG/);
  assert.doesNotMatch(navigation, /☰/);
  assert.doesNotMatch(navigation, />×</);
});

test("loads the standardized menu on the home and key portal pages", function () {
  const version = "/mobile_top_navigation.js?v=20260922-standard-menu-1";
  assert.equal(runtimeConfig.includes(version), true);
  assert.equal(home.includes(version), true);
  assert.equal(studentArea.includes(version), true);
  assert.equal(myClass.includes(version), true);
});

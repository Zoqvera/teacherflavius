const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "site_page_context.js"), "utf8");

function createPageContext(pathname) {
  const window = {
    location: { pathname: pathname }
  };
  vm.runInNewContext(source, { window: window });
  return window.SitePageContext;
}

test("identifica home limpa e variante legada", function () {
  const context = createPageContext("/");
  assert.equal(context.isHomePage("/"), true);
  assert.equal(context.isHomePage("/index" + ".html"), true);
  assert.equal(context.isHomePage("/sobre/"), false);
});

test("identifica páginas de conteúdo geográfico", function () {
  const context = createPageContext("/sobre/");
  assert.equal(context.isGeoContentPage("/sobre/"), true);
  assert.equal(context.isGeoContentPage("/recursos/guia/"), true);
  assert.equal(context.isGeoContentPage("/login/"), false);
});

test("identifica páginas de vendas incluindo variante legada", function () {
  const context = createPageContext("/quero-conhecer/");
  assert.equal(context.isSalesPage("/quero_conhecer"), true);
  assert.equal(context.isSalesPage("/quero_conhecer" + ".html"), true);
  assert.equal(context.isSalesPage("/curso-de-ingles-online/"), true);
  assert.equal(context.isSalesPage("/landing-page/campanha/"), true);
  assert.equal(context.isSalesPage("/perfil/"), false);
});

test("classifica páginas públicas sem incluir rotas do portal", function () {
  const context = createPageContext("/privacidade/");
  assert.equal(context.isPublicMarketingPage("/privacidade/"), true);
  assert.equal(context.isPublicMarketingPage("/cookies/"), true);
  assert.equal(context.isPublicMarketingPage("/termos/"), true);
  assert.equal(context.isPublicMarketingPage("/recursos/"), true);
  assert.equal(context.isPublicMarketingPage("/area-do-estudante/"), false);
  assert.equal(context.isPublicMarketingPage("/professor/"), false);
});

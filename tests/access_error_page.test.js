const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPage(search) {
  const nodes = Object.fromEntries(
    ["access-status-title", "access-status-message", "access-status-primary"]
      .map(function (id) {
        return [id, { textContent: "", href: "" }];
      })
  );
  const document = {
    title: "Acesso não autorizado - Teacher Flávio",
    getElementById: function (id) { return nodes[id] || null; }
  };
  const context = {
    URLSearchParams: URLSearchParams,
    window: { location: { search: search } },
    document: document
  };
  const source = fs.readFileSync(
    path.join(__dirname, "..", "access_error_page.js"),
    "utf8"
  );

  vm.runInNewContext(source, context);
  return { nodes: nodes, document: document };
}

test("shows a connection-specific message and retries the original route", function () {
  const page = loadPage("?reason=connection&next=%2Farea-do-estudante%2Frecursos%2F");

  assert.equal(page.nodes["access-status-title"].textContent, "Conexão indisponível");
  assert.match(page.nodes["access-status-message"].textContent, /Supabase/);
  assert.equal(page.nodes["access-status-primary"].textContent, "TENTAR NOVAMENTE");
  assert.equal(page.nodes["access-status-primary"].href, "/area-do-estudante/recursos/");
});

test("supports temporary verification errors without claiming denied permission", function () {
  const page = loadPage("?reason=verification&next=%2Fatividade%2F");

  assert.match(page.nodes["access-status-title"].textContent, /verificar seu acesso/);
  assert.equal(page.nodes["access-status-primary"].href, "/atividade/");
});

test("rejects external and recursive retry destinations", function () {
  const destinations = ["//example.com", "/\\\\example.com", "/acesso-negado/", "https://example.com"];
  destinations.forEach(function (destination) {
    const page = loadPage("?reason=connection&next=" + encodeURIComponent(destination));
    assert.equal(page.nodes["access-status-primary"].href, "/area-do-estudante/");
  });
});

test("leaves explicit authorization denial unchanged", function () {
  const page = loadPage("");

  assert.equal(page.nodes["access-status-title"].textContent, "");
  assert.equal(page.nodes["access-status-primary"].textContent, "");
  assert.equal(page.document.title, "Acesso não autorizado - Teacher Flávio");
});

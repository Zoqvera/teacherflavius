"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

const STRICT_EVENT_HANDLER_PAGES = Object.freeze([
  "index.html",
  "login.html",
  "complete-cadastro.html",
  "professor.html",
  "matricula80/index.html",
  "pagamento/index.html",
  "area_do_estudante.html",
  "mensalidades.html",
  "turmas.html",
  "cadastro.html"
]);

const LEGACY_EVENT_HANDLER_PAGES = Object.freeze([
  "perfil-dos-alunos/index.html",
  "perfil_dos_alunos.html",
  "perfil.html",
  "perfil/index.html",
  "turma.html",
  "resultados.html"
]);

const INLINE_EVENT_ATTRIBUTE =
  /\s+on(?:click|load|error|submit|change|input|focus|blur|keydown|keyup|mouseover|mouseout|mouseenter|mouseleave|touchstart|touchend|pointerdown|pointerup)\s*=/i;

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertEnforcedMeta(relativePath, expectedDirectives) {
  const html = readFile(relativePath);
  const head = html.search(/<head\b[^>]*>/i);
  const firstScript = html.search(/<script\b/i);
  const metaTags = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?\s*>/gi)];

  assert.ok(head >= 0, `${relativePath}: HTML head must exist`);
  assert.equal(metaTags.length, 1, `${relativePath}: exactly one enforced CSP meta tag`);
  const meta = metaTags[0];
  assert.ok(meta.index > head, `${relativePath}: CSP must be inside the head`);
  assert.ok(firstScript < 0 || meta.index < firstScript, `${relativePath}: CSP must precede scripts`);
  if (relativePath === "matricula80/index.html") {
    assert.ok(
      meta[1].startsWith(expectedDirectives + "; script-src 'self' "),
      "The enrollment pilot must enforce a restrictive script-src policy"
    );
    assert.match(meta[1], /https:\/\/cdn\.jsdelivr\.net/);
    assert.match(meta[1], /https:\/\/www\.googletagmanager\.com/);
    assert.match(meta[1], /https:\/\/static\.cloudflareinsights\.com/);
    assert.match(meta[1], /https:\/\/connect\.facebook\.net/);
    assert.equal((meta[1].match(/'sha256-[A-Za-z0-9+\/=]+'/g) || []).length, 2);
  } else {
    assert.equal(meta[1], expectedDirectives, `${relativePath}: policy must match audited directives`);
  }
  assert.doesNotMatch(meta[1], /unsafe-inline|unsafe-eval/i);
  assert.doesNotMatch(meta[1], /frame-ancestors|report-uri|report-to/i);
}

test("approved entrypoints enforce safe browser CSP directives before scripts", () => {
  for (const file of STRICT_EVENT_HANDLER_PAGES) {
    const policy = "object-src 'none'; base-uri 'self'; script-src-attr 'none'";
    assertEnforcedMeta(file, policy);
    assert.doesNotMatch(readFile(file), INLINE_EVENT_ATTRIBUTE, `${file}: inline event handlers must not be used`);
  }
});

test("legacy routes preserve functional handlers while blocking plugin and base injection", () => {
  for (const file of LEGACY_EVENT_HANDLER_PAGES) {
    assertEnforcedMeta(file, "object-src 'none'; base-uri 'self'");
  }
});

test("monitoring-only HTTP header remains separate from the enforced meta policy", () => {
  const headers = readFile("hosting/_headers");
  assert.match(headers, /Content-Security-Policy-Report-Only:/);
  assert.match(headers, /report-uri https:\/\//);
  assert.doesNotMatch(headers, /^\s+Content-Security-Policy:/m);
});

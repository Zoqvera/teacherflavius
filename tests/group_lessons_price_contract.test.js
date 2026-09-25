const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "aulas-em-grupo", "index.html"), "utf8");
const coursePage = fs.readFileSync(path.join(root, "curso-de-ingles-online", "index.html"), "utf8");
const headers = fs.readFileSync(path.join(root, "hosting", "_headers"), "utf8");

test("group lessons page consistently exposes the R$ 50,00 monthly price", function () {
  assert.match(page, /R\$ 50,00 por mês/);
  assert.match(page, /<p class="price">R\$ 50,00<\/p>/);
  assert.match(page, /"price":"50\.00"/);
  assert.match(page, /data-monthly-price-brl="50\.00"/);
  assert.doesNotMatch(page, /R\$ 99,90/);
});

test("group lessons landing page is revalidated instead of serving stale pricing", function () {
  assert.match(
    headers,
    /\/aulas-em-grupo\/\n  Cache-Control: no-cache, max-age=0, must-revalidate/
  );
});


test("commercial course metadata and copy use R$ 50,00 per month and up to 5 students", function () {
  assert.match(coursePage, /<meta name="description" content="[^"]*turmas de até 5 alunos[^"]*R\$ 50,00 por mês\."/);
  assert.match(coursePage, /<meta property="og:description" content="[^"]*turmas de até 5 alunos[^"]*R\$ 50,00 por mês\."/);
  assert.match(coursePage, /"price":"50\.00"/);
  assert.match(coursePage, /turmas de até 5 alunos/);
  assert.doesNotMatch(coursePage, /R\$\s*99,90/i);
  assert.doesNotMatch(coursePage, /(?:até\s+4|quatro)\s+alunos/i);
  assert.doesNotMatch(page, /R\$\s*99,90/i);
  assert.doesNotMatch(page, /(?:até\s+4|quatro)\s+alunos/i);
});

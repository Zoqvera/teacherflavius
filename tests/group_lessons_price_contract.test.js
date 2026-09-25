const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "aulas-em-grupo", "index.html"), "utf8");
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

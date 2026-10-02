const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "aulas-em-grupo/index.html"), "utf8");

test("group Instagram card keeps readable text on the branded dark background", function () {
  assert.match(
    page,
    /html\.tf-brand-sales body\.page-group-lessons \.instagram-card\{[^}]*background:linear-gradient\(135deg,#071a38 0%,#0a2d60 100%\)!important/
  );
  assert.match(
    page,
    /html\.tf-brand-sales body\.page-group-lessons \.instagram-copy h2\{color:#fff!important/
  );
  assert.match(
    page,
    /html\.tf-brand-sales body\.page-group-lessons \.instagram-copy p:last-child\{color:#dbe7f5!important;font-weight:600/
  );
  assert.match(
    page,
    /html\.tf-brand-sales body\.page-group-lessons \.instagram-kicker\{color:#ff9ac6!important/
  );
});

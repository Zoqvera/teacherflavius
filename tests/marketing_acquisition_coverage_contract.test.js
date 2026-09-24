const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("group and individual lesson pages belong to the first-party acquisition funnel", function () {
  const source = read("analytics_attribution.js");

  assert.match(source, /path\.indexOf\("\/aulas-em-grupo"\) === 0/);
  assert.match(source, /path\.indexOf\("\/aulas-individuais"\) === 0/);
  assert.match(source, /tracks_first_party_leads:\s*isAcquisitionPage\(\)/);
});

test("operational tracker yields only when attribution explicitly owns lead persistence", function () {
  const source = read("marketing_whatsapp_tracker.js");

  assert.match(
    source,
    /window\.TeacherCroAttribution\.tracks_first_party_leads === true/
  );
});

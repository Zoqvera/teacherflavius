const test = require("node:test");
const assert = require("node:assert/strict");
const integration = require("../system_health_reports_integration.js");

test("exposes canonical system health report route", function () {
  assert.equal(integration.TAB_ID, "systemHealthReportTab");
  assert.equal(integration.FRAME_ID, "systemHealthFrame");
  assert.equal(integration.FRAME_SRC, "/saude-do-sistema/");
});

test("does not initialize without browser dependencies", function () {
  assert.equal(integration.initialize({}), false);
  assert.equal(integration.initialize({ windowRef: {}, documentRef: null }), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const patch = fs.readFileSync(
  path.join(root, "scripts/sql/monitor_optional_openai_pixel_failures_20261104.sql"),
  "utf8"
);
const dashboard = fs.readFileSync(path.join(root, "system_health_dashboard.js"), "utf8");
const pixel = fs.readFileSync(path.join(root, "openai_pixel.js"), "utf8");

test("preserves OpenAI marketing pixel and records its failures separately", () => {
  assert.match(pixel, /https:\/\/bzrcdn\.openai\.com\/sdk\/oaiq\.min\.js/);
  assert.match(patch, /optional_openai_pixel_errors_15m/);
  assert.match(patch, /e\.source = 'https:\/\/bzrcdn\.openai\.com\/sdk\/oaiq\.min\.js'/);
  assert.match(dashboard, /metrics\.optional_openai_pixel_errors_15m/);
});

test("excludes only the known optional SDK from actionable resource bursts", () => {
  assert.match(patch, /e\.event_type = 'resource'/);
  assert.match(patch, /coalesce\(e\.source, ''\) <> 'https:\/\/bzrcdn\.openai\.com\/sdk\/oaiq\.min\.js'/);
  assert.match(patch, /resource_top_fingerprint_count/);
  assert.match(patch, /old_top_filter/);
  assert.match(patch, /<> 2 THEN/);
  assert.match(patch, /Health function changed: stop and review/);
  assert.match(dashboard, /metrics\.resource_errors_15m/);
});

test("keeps the existing resource alert threshold and pixel telemetry", () => {
  assert.match(patch, /resource_errors_15m >= 15 and resource_top_fingerprint_count >= 5/);
  assert.match(patch, /SELECT pg_get_functiondef/);
  assert.doesNotMatch(patch, /DELETE FROM public\.app_error_events/i);
  assert.doesNotMatch(patch, /TRUNCATE public\.app_error_events/i);
});

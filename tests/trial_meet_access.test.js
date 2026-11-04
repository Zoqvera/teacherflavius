const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const report = require("../trial_meet_report.js");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "aula-experimental/index.html"), "utf8");
const pageStyles = fs.readFileSync(path.join(root, "aula-experimental/styles.css"), "utf8");
const admin = fs.readFileSync(path.join(root, "aulas-experimentais/index.html"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261022135918_trial_meet_accesses_20261022.sql"),
  "utf8"
);
const endpoint = fs.readFileSync(
  path.join(root, "supabase/functions/trial-meet-access/index.ts"),
  "utf8"
);
const routeLoader = fs.readFileSync(path.join(root, "clean_route_loader.js"), "utf8");
const notFoundPage = fs.readFileSync(path.join(root, "404.html"), "utf8");

test("retired public entry contains no form, personal data inputs or meeting links", () => {
  assert.match(page, /O formulário de acesso às aulas experimentais foi descontinuado/);
  assert.match(page, /FALAR PELO WHATSAPP/);
  assert.match(page, /href="https:\/\/wa\.me\/5534998349756/);
  assert.doesNotMatch(page, /<form\b|<input\b|<button\b/i);
  assert.doesNotMatch(page, /trial_meet_access\.js|meet\.google\.com|name="whatsapp"/);
  assert.equal(fs.existsSync(path.join(root, "trial_meet_access.js")), false);
});

test("retired page keeps the existing non-indexed clean URL and readable layout", () => {
  assert.match(page, /content="noindex, nofollow"/);
  assert.match(page, /href="https:\/\/teacherflavius\.com\/aula-experimental\/"/);
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(page, /\/aula-experimental\/styles\.css\?v=20261104-retired-1/);
  assert.match(pageStyles, /min-height:\s*100svh/);
  assert.match(pageStyles, /@media \(max-width: 767px\)/);
  assert.match(pageStyles, /a:focus-visible/);
});

test("clean URL recovery serves the retired notice at both route variants", async () => {
  assert.match(notFoundPage, /clean_route_loader\.js\?v=20261022-trial-fallback-1/);

  for (const pathname of ["/aula-experimental", "/aula-experimental/"]) {
    const requested = [];
    const written = [];
    const context = {
      window: { location: { pathname } },
      document: {
        open() {},
        write(html) { written.push(html); },
        close() {}
      },
      fetch: async (url, options) => {
        requested.push({ url, options });
        return {
          ok: true,
          text: async () => '<!DOCTYPE html><html><head><title>AULAS EXPERIMENTAIS</title></head><body>O formulário foi descontinuado.</body></html>'
        };
      },
      console: { error(message) { throw new Error(message); } }
    };
    vm.runInNewContext(routeLoader, context, { filename: "clean_route_loader.js" });
    await new Promise(setImmediate);

    assert.equal(requested.length, 1);
    assert.equal(requested[0].url, "/aula-experimental/" + "index.html");
    assert.equal(requested[0].options.cache, "no-store");
    assert.equal(written.length, 1);
    assert.match(written[0], /O formulário foi descontinuado/);
    assert.ok(written[0].includes('<base href="/">'));
  }
});

test("retired endpoint never accepts submissions or accesses the database", () => {
  assert.match(endpoint, /Deno\.serve/);
  assert.match(endpoint, /status:\s*410/);
  assert.match(endpoint, /Este formulário foi descontinuado/);
  assert.match(endpoint, /Cache-Control/);
  assert.doesNotMatch(endpoint, /record_trial_meet_access|createClient|SUPABASE_SERVICE_ROLE_KEY|\.rpc\(/);
});

test("administrator retains a safe historical record viewer", () => {
  const html = report.renderEntries([{
    visitor_name: '<img src=x onerror=alert(1)>',
    whatsapp_digits: "5534999991234",
    lesson_slot: "friday_15",
    accessed_at: "2026-10-23T18:00:00Z"
  }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Sexta-feira 15h/);
  assert.match(html, /ACESSOU O LINK/);
  assert.match(admin, /Histórico do formulário descontinuado/);
  assert.match(admin, /trialMeetReportList/);
  assert.match(admin, /trial_meet_report\.js/);
});

test("historical access data stays private and is not dropped", () => {
  assert.match(migration, /create table if not exists private\.trial_meet_accesses/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table private\.trial_meet_accesses from public, anon, authenticated/i);
});

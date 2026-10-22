const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const entry = require("../trial_meet_access.js");
const report = require("../trial_meet_report.js");

const page = fs.readFileSync(path.join(__dirname, "..", "aula-experimental", "index.html"), "utf8");
const pageStyles = fs.readFileSync(path.join(__dirname, "..", "aula-experimental", "styles.css"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "aulas-experimentais", "index.html"), "utf8");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261022135918_trial_meet_accesses_20261022.sql"), "utf8"
);
const routeLoader = fs.readFileSync(path.join(__dirname, "..", "clean_route_loader.js"), "utf8");
const notFoundPage = fs.readFileSync(path.join(__dirname, "..", "404.html"), "utf8");
const endpoint = fs.readFileSync(
  path.join(__dirname, "../supabase/functions/trial-meet-access/index.ts"), "utf8"
);

test("each experimental class opens its exact Google Meet address", () => {
  assert.equal(entry.getMeetUrl("monday_18"), "https://meet.google.com/hxv-giye-but");
  assert.equal(entry.getMeetUrl("tuesday_10"), "https://meet.google.com/vqj-ufhs-rzt");
  assert.equal(entry.getMeetUrl("tuesday_15"), "https://meet.google.com/ccv-yotk-iwh");
  assert.equal(entry.getMeetUrl("thursday_20"), "https://meet.google.com/rma-wrwu-nry");
  assert.equal(entry.getMeetUrl("other"), "");
  for (const slot of ["monday_18", "tuesday_10", "tuesday_15", "thursday_20"]) {
    assert.match(page, new RegExp('value="' + slot + '"'));
  }
});

test("404 recovery renders the experimental form on bare and trailing-slash paths", async () => {
  assert.match(notFoundPage, /clean_route_loader\\.js\\?v=20261022-trial-fallback-1/);

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
          text: async () => '<!DOCTYPE html><html><head><title>AULAS EXPERIMENTAIS</title></head><body>Formulário</body></html>'
        };
      },
      console: { error(message) { throw new Error(message); } }
    };

    vm.runInNewContext(routeLoader, context, { filename: "clean_route_loader.js" });
    await new Promise(setImmediate);

    assert.equal(requested.length, 1);
    assert.equal(requested[0].url, "/aula-experimental/index.html");
    assert.equal(requested[0].options.cache, "no-store");
    assert.equal(written.length, 1);
    assert.match(written[0], /AULAS EXPERIMENTAIS/);
    assert.match(written[0], /<base href="\\/">/);
  }
});

test("contact validation accepts Brazilian numbers and rejects incomplete data", () => {
  assert.equal(entry.isValidContact("Ana Maria", "(34) 99999-1234"), true);
  assert.equal(entry.isValidContact("A", "(34) 99999-1234"), false);
  assert.equal(entry.isValidContact("Ana", "123"), false);
  assert.equal(entry.isValidContact("Ana", "+55 34 99999-1234"), true);
});

test("public page has exactly the requested fields and no marketing checkbox", () => {
  assert.match(page, /<h1 id="trial-heading">AULAS EXPERIMENTAIS<\/h1>/);
  assert.match(page, /name="visitor_name"/);
  assert.match(page, /name="whatsapp"/);
  assert.match(page, /PARTICIPAR DA AULA/);
  assert.doesNotMatch(page, /type="checkbox"/);
  assert.match(page, /content="noindex, nofollow"/);
});

test("experimental lesson form uses readable mobile sizing", () => {
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(page, /\/aula-experimental\/styles\.css\?v=20261022-mobile-2/);
  assert.match(pageStyles, /@media \(max-width: 1024px\)/);
  assert.match(pageStyles, /max-width: 900px;/);
  assert.match(pageStyles, /min-height: 100svh;/);
  assert.match(pageStyles, /@media \(max-width: 767px\)/);
  assert.match(pageStyles, /#trialMeetForm #visitorName/);
  assert.match(pageStyles, /#trialMeetForm #visitorWhatsapp/);
  assert.match(pageStyles, /min-height: 62px;/);
});

test("client redirects only after server confirms successful saving", async () => {
  let called = false;
  const windowRef = {
    setTimeout: () => 1,
    clearTimeout: () => {},
    fetch: async (url, options) => {
      called = true;
      assert.match(url, /\/functions\/v1\/trial-meet-access$/);
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { request_id: "id" });
      return { ok: true, json: async () => ({ ok: true }) };
    }
  };
  assert.equal(await entry.submitEntry(windowRef, { request_id: "id" }), true);
  assert.equal(called, true);
  await assert.rejects(
    () => entry.submitEntry({
      ...windowRef,
      fetch: async () => ({ ok: false, json: async () => ({ error: "Falha" }) })
    }, {}),
    /Falha/
  );
});

test("administrator sees escaped contact data but not an unverified presence claim", () => {
  const html = report.renderEntries([{
    visitor_name: '<img src=x onerror=alert(1)>',
    whatsapp_digits: "5534999991234",
    lesson_slot: "monday_18",
    accessed_at: "2026-10-22T13:20:00Z"
  }]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /wa\.me\/5534999991234/);
  assert.match(html, /ACESSOU O LINK/);
  assert.match(admin, /id="trialMeetReportList"/);
  assert.match(admin, /trial_meet_report\.js/);
});

test("personal data is private and can be ingested only server-side", () => {
  assert.match(migration, /create table if not exists private\.trial_meet_accesses/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table private\.trial_meet_accesses from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.record_trial_meet_access\(uuid,text,text,text\)\s+to service_role/i);
  assert.match(migration, /is_teacher_admin_mfa\(\)/);
  assert.match(endpoint, /consume_api_rate_limit/);
  assert.match(endpoint, /record_trial_meet_access/);
});

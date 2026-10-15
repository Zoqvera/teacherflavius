"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "student_preparation_flow.js"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261015213000_student_preparation_pilot_eligibility.sql"),
  "utf8"
);
const PREVIEW_HOST = "stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev";

function createScenario({
  hostname = "teacherflavius.com",
  armed = false,
  globalEnabled = false,
  memberEnabled = false,
  globalError = false,
  memberError = false,
  analyticsConsent = true
} = {}) {
  const reads = [];
  const events = [];
  const client = {
    from(table) {
      return {
        select(fields) {
          assert.equal(fields, "enabled");
          return {
            eq(column, value) {
              reads.push({ table, column, value });
              return {
                async maybeSingle() {
                  if (table === "student_preparation_pilot_settings") {
                    return {
                      data: globalEnabled ? { enabled: true } : null,
                      error: globalError ? new Error("No access") : null
                    };
                  }
                  if (table === "student_preparation_pilot_members") {
                    return {
                      data: memberEnabled ? { enabled: true } : null,
                      error: memberError ? new Error("No access") : null
                    };
                  }
                  throw new Error("Unexpected table " + table);
                }
              };
            }
          };
        }
      };
    }
  };
  const window = {
    location: { hostname },
    TeacherFlaviusPrivacy: { hasAnalyticsConsent: () => analyticsConsent },
    gtag(...args) { events.push(args); }
  };
  const source = armed
    ? script.replace("const PRODUCTION_PILOT_ARMED = false;", "const PRODUCTION_PILOT_ARMED = true;")
    : script;
  vm.runInNewContext(source, { window, console: { error() {} } });
  return { client, window, reads, events };
}

test("the committed production kill switch remains disabled", async () => {
  assert.match(script, /const PRODUCTION_PILOT_ARMED = false;/);
  const context = createScenario({ globalEnabled: true, memberEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), false);
  assert.equal(context.window.StudentPreparationFlow.enabled, false);
  assert.equal(context.reads.length, 0);
});

test("production gate requires both operator switch and the current student's row", async () => {
  const context = createScenario({ armed: true, globalEnabled: true, memberEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), true);
  assert.equal(context.window.StudentPreparationFlow.enabled, true);
  assert.equal(context.reads.length, 2);
  assert.deepEqual(context.reads.map(item => item.table), [
    "student_preparation_pilot_settings",
    "student_preparation_pilot_members"
  ]);
  assert.deepEqual(context.reads.map(item => item.value), [true, "student-1"]);
});

test("revoked global switch excludes the member without querying the allowlist", async () => {
  const context = createScenario({ armed: true, memberEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), false);
  assert.equal(context.reads.length, 1);
});

test("missing, revoked, or inaccessible individual authorization fails closed", async () => {
  for (const options of [
    { armed: true, globalEnabled: true },
    { armed: true, globalEnabled: true, memberEnabled: true, memberError: true },
    { armed: true, globalEnabled: true, globalError: true }
  ]) {
    const context = createScenario(options);
    assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), false);
    assert.equal(context.window.StudentPreparationFlow.enabled, false);
  }
});

test("no hostname spoofing, unidentified visitors, or arbitrary host activation", async () => {
  for (const hostname of ["preview.example", PREVIEW_HOST + ".bad.example", "random.example"]) {
    const context = createScenario({ hostname, armed: true, globalEnabled: true, memberEnabled: true });
    assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), false);
    assert.equal(context.reads.length, 0);
  }
  const context = createScenario({ armed: true, globalEnabled: true, memberEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, ""), false);
  assert.equal(context.reads.length, 0);
});

test("preview remains available and does not query live pilot records", async () => {
  const context = createScenario({ hostname: PREVIEW_HOST });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(null, null), true);
  assert.equal(context.window.StudentPreparationFlow.enabled, true);
  assert.equal(context.reads.length, 0);
});

test("monitoring emits only enumerated event names without student identifiers", async () => {
  const context = createScenario({ hostname: PREVIEW_HOST });
  const flow = context.window.StudentPreparationFlow;
  flow.track("preparation_next_part");
  flow.track("some_unregistered_event");
  assert.equal(context.events.length, 1);
  assert.equal(context.events[0][0], "event");
  assert.equal(context.events[0][1], "preparation_next_part");
  assert.equal(context.events[0][2].event_category, "student_preparation");
  assert.equal(Object.keys(context.events[0][2]).length, 1);
});

test("RLS prevents unauthorized access and students cannot mutate pilot records", () => {
  for (const table of ["student_preparation_pilot_settings", "student_preparation_pilot_members"]) {
    assert.ok(migration.includes("alter table public." + table + " enable row level security"));
    assert.ok(migration.includes("revoke all on table public." + table + " from public, anon, authenticated"));
    assert.ok(migration.includes("grant select on public." + table + " to authenticated"));
    assert.ok(!migration.includes("grant insert on public." + table + " to authenticated"));
    assert.ok(!migration.includes("grant update on public." + table + " to authenticated"));
  }
  assert.match(migration, /to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /values \(true, false\)/);
});

test("analytics consent denial prevents pilot telemetry", () => {
  const context = createScenario({ hostname: PREVIEW_HOST, analyticsConsent: false });
  context.window.StudentPreparationFlow.track("preparation_next_part");
  assert.equal(context.events.length, 0);
});

test("all three student views resolve identity after validating the session", () => {
  for (const file of ["o-que-fazer/app.js", "licao.js", "roteiro_de_estudos.html"]) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(content, /resolveEligibility\(/);
    assert.match(content, /getSession\(\)/);
  }
});

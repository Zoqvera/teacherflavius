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
  armed = true,
  globalEnabled = false,
  enrolled = true,
  archived = false,
  profileUserId = "student-1",
  globalError = false,
  profileError = false,
  analyticsConsent = true
} = {}) {
  const reads = [];
  const events = [];
  const client = {
    from(table) {
      return {
        select(fields) {
          assert.equal(
            fields,
            table === "student_preparation_pilot_settings" ? "enabled" : "enrolled,archived"
          );
          return {
            eq(column, value) {
              reads.push({ table, column, value });
              return {
                async maybeSingle() {
                  if (table === "student_preparation_pilot_settings") {
                    return {
                      data: globalEnabled ? { enabled: true } : { enabled: false },
                      error: globalError ? new Error("Master switch inaccessible") : null
                    };
                  }
                  if (table === "profiles") {
                    return {
                      data: value === profileUserId ? { enrolled, archived } : null,
                      error: profileError ? new Error("Own profile inaccessible") : null
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
    ? script
    : script.replace("const PRODUCTION_PILOT_ARMED = true;", "const PRODUCTION_PILOT_ARMED = false;");
  vm.runInNewContext(source, { window, console: { error() {} } });
  return { client, window, reads, events };
}

test("general release requires the enabled database master switch", async () => {
  assert.match(script, /const PRODUCTION_PILOT_ARMED = true;/);
  const context = createScenario();
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), false);
  assert.equal(context.window.StudentPreparationFlow.enabled, false);
  assert.deepEqual(context.reads.map(item => item.table), ["student_preparation_pilot_settings"]);
});

test("source-level emergency rollback bypasses all database reads", async () => {
  const context = createScenario({ armed: false, globalEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), false);
  assert.equal(context.window.StudentPreparationFlow.enabled, false);
  assert.equal(context.reads.length, 0);
});

test("all active enrolled students are eligible without individual allowlist rows", async () => {
  const context = createScenario({ globalEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"), true);
  assert.equal(context.window.StudentPreparationFlow.enabled, true);
  assert.deepEqual(context.reads.map(item => item.table), [
    "student_preparation_pilot_settings", "profiles"
  ]);
  assert.deepEqual(context.reads.map(item => item.value), [true, "student-1"]);
  assert.deepEqual(context.reads.map(item => item.column), ["id", "id"]);
});

test("a new active enrolment is eligible without any pilot list registration", async () => {
  const context = createScenario({
    globalEnabled: true,
    profileUserId: "newly-enrolled",
    enrolled: true,
    archived: false
  });
  assert.equal(
    await context.window.StudentPreparationFlow.resolveEligibility(context.client, "newly-enrolled"),
    true
  );
  assert.equal(context.reads.length, 2);
  assert.ok(context.reads.every(item => item.table !== "student_preparation_pilot_members"));
});

test("archived, unenrolled, missing and inaccessible profiles fail closed", async () => {
  const scenarios = [
    { enrolled: true, archived: true },
    { enrolled: false, archived: false },
    { profileUserId: "other-student" },
    { profileError: true },
    { enrolled: null },
    { archived: null }
  ];
  for (const options of scenarios) {
    const context = createScenario({ globalEnabled: true, ...options });
    assert.equal(
      await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"),
      false
    );
    assert.equal(context.window.StudentPreparationFlow.enabled, false);
  }
});

test("a revoked switch or inaccessible settings deny access before querying profiles", async () => {
  for (const options of [{}, { globalEnabled: true, globalError: true }]) {
    const context = createScenario(options);
    assert.equal(
      await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"),
      false
    );
    assert.equal(context.reads.length, 1);
  }
});

test("no hostname spoofing, unidentified visitors or unauthorized hostname activation", async () => {
  for (const hostname of ["preview.example", PREVIEW_HOST + ".bad.example", "random.example"]) {
    const context = createScenario({ hostname, globalEnabled: true });
    assert.equal(
      await context.window.StudentPreparationFlow.resolveEligibility(context.client, "student-1"),
      false
    );
    assert.equal(context.reads.length, 0);
  }
  const context = createScenario({ globalEnabled: true });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(context.client, ""), false);
  assert.equal(context.reads.length, 0);
});

test("preview stays isolated and does not query production eligibility", async () => {
  const context = createScenario({ hostname: PREVIEW_HOST });
  assert.equal(await context.window.StudentPreparationFlow.resolveEligibility(null, null), true);
  assert.equal(context.window.StudentPreparationFlow.enabled, true);
  assert.equal(context.reads.length, 0);
});

test("tracking emits only enumerated events with analytics consent and no student identifiers", () => {
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

test("pilot tables remain RLS-protected and cannot be changed by students", () => {
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

test("analytics consent denial prevents release telemetry", () => {
  const context = createScenario({ hostname: PREVIEW_HOST, analyticsConsent: false });
  context.window.StudentPreparationFlow.track("preparation_next_part");
  assert.equal(context.events.length, 0);
});

test("all student views verify a session before resolving eligibility", () => {
  for (const file of ["o-que-fazer/app.js", "licao.js", "roteiro_de_estudos.html"]) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(content, /resolveEligibility\(/);
    assert.match(content, /getSession\(\)/);
  }
});

test("switching logged-in accounts immediately clears stale eligibility", async () => {
  const context = createScenario({ globalEnabled: true, profileUserId: "student-1" });
  const flow = context.window.StudentPreparationFlow;
  assert.equal(await flow.resolveEligibility(context.client, "student-1"), true);
  assert.equal(flow.enabled, true);
  assert.equal(await flow.resolveEligibility(context.client, "student-2"), false);
  assert.equal(flow.enabled, false);
  assert.equal(await flow.resolveEligibility(context.client, "student-1"), true);
  assert.equal(flow.enabled, true);
  assert.equal(await flow.resolveEligibility(null, null), false);
  assert.equal(flow.enabled, false);
});

test("a delayed response from a prior account cannot unlock a later session", async () => {
  const context = createScenario({ globalEnabled: true });
  const flow = context.window.StudentPreparationFlow;
  let completeFirstProfileRequest;
  const waiting = new Promise(resolve => { completeFirstProfileRequest = resolve; });
  const delayedClient = {
    from(table) {
      if (table !== "profiles") return context.client.from(table);
      return {
        select(fields) {
          assert.equal(fields, "enrolled,archived");
          return {
            eq(column, value) {
              assert.equal(column, "id");
              return {
                async maybeSingle() {
                  if (value === "student-1") return waiting;
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const first = flow.resolveEligibility(delayedClient, "student-1");
  const second = flow.resolveEligibility(delayedClient, "student-2");
  assert.equal(await second, false);
  completeFirstProfileRequest({ data: { enrolled: true, archived: false }, error: null });
  assert.equal(await first, false);
  assert.equal(flow.enabled, false);
});

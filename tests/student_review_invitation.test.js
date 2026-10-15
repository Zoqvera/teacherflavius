const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const invitation = require("../student_review_invitation.js");

function read(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

function createHarness(profile, review) {
  let reviewCalls = 0;
  const trackedEvents = [];
  let modalOpens = 0;
  const handlers = {};
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) || null,
    setItem: (key, value) => storageValues.set(key, value)
  };
  const dialog = {
    open: false,
    showModal() {
      modalOpens += 1;
      this.open = true;
    },
    close() {
      this.open = false;
      if (handlers.close) handlers.close();
    },
    addEventListener(event, handler) {
      handlers[event] = handler;
    },
    querySelector(selector) {
      if (selector === "[data-review-invitation-close]") {
        return { addEventListener: (_event, handler) => { handlers.dismiss = handler; } };
      }
      if (selector === "[data-review-invitation-link]") {
        return { addEventListener: (_event, handler) => { handlers.link = handler; } };
      }
      return null;
    }
  };
  const client = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select(columns) {
          assert.match(columns, /enrolled_at,created_at/);
          return {
            eq(field, value) {
              assert.equal(field, "id");
              assert.equal(value, "student-123");
              return { maybeSingle: async () => ({ data: profile, error: null }) };
            }
          };
        }
      };
    },
    async rpc(name, params) {
      if (name === "record_my_student_review_invitation") {
        trackedEvents.push(params.target_action);
        return { data: true, error: null };
      }
      assert.equal(name, "get_my_student_review");
      reviewCalls += 1;
      return { data: review, error: null };
    }
  };
  return {
    client,
    dialog,
    storage,
    handlers,
    trackedEvents,
    get modalOpens() { return modalOpens; },
    get reviewCalls() { return reviewCalls; }
  };
}

const REFERENCE_DATE = new Date("2026-10-15T12:00:00-03:00");
const ACTIVE_PROFILE = Object.freeze({
  enrolled: true,
  archived: false,
  enrolled_at: "2026-08-15T11:00:00-03:00",
  created_at: "2026-08-01T11:00:00-03:00"
});

function options(harness, extra) {
  return {
    client: harness.client,
    studentId: "student-123",
    dialog: harness.dialog,
    storage: harness.storage,
    now: REFERENCE_DATE,
    ...extra
  };
}

test("two complete calendar months use the Brazilian school date, including month ends", () => {
  assert.equal(invitation.hasCompletedTwoMonths(
    "2026-08-15T11:00:00-03:00", new Date("2026-10-14T23:59:59-03:00")
  ), false);
  assert.equal(invitation.hasCompletedTwoMonths(
    "2026-08-15T11:00:00-03:00", new Date("2026-10-15T00:00:00-03:00")
  ), true);
  assert.equal(invitation.hasCompletedTwoMonths(
    "2026-08-31T10:00:00-03:00", new Date("2026-10-30T12:00:00-03:00")
  ), false);
  assert.equal(invitation.hasCompletedTwoMonths(
    "2026-08-31T10:00:00-03:00", new Date("2026-10-31T12:00:00-03:00")
  ), true);
  assert.equal(invitation.hasCompletedTwoMonths(
    "2023-12-31T10:00:00-03:00", new Date("2024-02-29T12:00:00-03:00")
  ), true);
  assert.equal(invitation.hasCompletedTwoMonths(null, REFERENCE_DATE), false);
  assert.equal(invitation.hasCompletedTwoMonths("invalid-date", REFERENCE_DATE), false);
});

test("active students can see the invitation after two months when they never reviewed", async () => {
  const harness = createHarness(ACTIVE_PROFILE, { review: null });

  assert.equal(await invitation.initialize(options(harness)), true);
  assert.equal(harness.modalOpens, 1);
  assert.equal(harness.reviewCalls, 1);
  assert.deepEqual(harness.trackedEvents, ["shown"]);

  harness.handlers.dismiss();
  assert.deepEqual(harness.trackedEvents, ["shown", "dismissed"]);
  assert.equal(harness.dialog.open, false);
  assert.equal(await invitation.initialize(options(harness, { now: new Date() })), false);
  assert.equal(harness.modalOpens, 1, "dismissal should suppress reopening for seven days");
});

test("existing reviews of any moderation status suppress the invitation", async () => {
  for (const status of ["pending", "approved", "rejected"]) {
    const harness = createHarness(ACTIVE_PROFILE, { review: { status } });
    assert.equal(await invitation.initialize(options(harness)), false);
    assert.equal(harness.modalOpens, 0);
    assert.equal(harness.reviewCalls, 1);
  }
});

test("premature, archived, non-enrolled and professor sessions never display the invitation", async () => {
  const cases = [
    { ...ACTIVE_PROFILE, enrolled_at: "2026-09-01T10:00:00-03:00" },
    { ...ACTIVE_PROFILE, archived: true },
    { ...ACTIVE_PROFILE, enrolled: false }
  ];

  for (const profile of cases) {
    const harness = createHarness(profile, { review: null });
    assert.equal(await invitation.initialize(options(harness)), false);
    assert.equal(harness.reviewCalls, 0);
  }

  const professor = createHarness(ACTIVE_PROFILE, { review: null });
  assert.equal(await invitation.initialize(options(professor, { isProfessor: true })), false);
  assert.equal(professor.reviewCalls, 0);
});

test("the dashboard uses the same modal for the browser and installed PWA", () => {
  const html = read("area_do_estudante.html");
  const dashboard = read("area_do_estudante.js");
  const css = read("student_review_invitation.css");

  assert.match(html, /id="studentReviewInvitation"/);
  assert.match(html, /href="\/avaliar-aulas\/">AVALIAR AGORA<\/a>/);
  assert.match(html, /student_review_invitation\.js\?v=20261015-invitation-retry-1/);
  assert.match(html, /student_review_invitation\.css\?v=20261015-1/);
  assert.match(dashboard, /await initializeReviewInvitation\(\)/);
  assert.match(dashboard, /isProfessor: isProfessorSession\(\)/);
  assert.match(css, /student-review-invitation::backdrop/);
});

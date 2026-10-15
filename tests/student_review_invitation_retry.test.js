const test = require("node:test");
const assert = require("node:assert/strict");
const invitation = require("../student_review_invitation.js");

const STUDENT_ID = "synthetic-student";
const EVENT_PREFIX = "teacherflavius:student-review-invitation-pending:";
const SNOOZE_PREFIX = "teacherflavius:student-review-invitation:";
const PROFILE = {
  enrolled: true,
  archived: false,
  enrolled_at: "2026-06-01T10:00:00-03:00",
  created_at: "2026-05-01T10:00:00-03:00"
};

function harness() {
  const values = new Map();
  const tracked = [];
  const handlers = {};
  let failNextShown = false;
  let hasReview = false;
  let opened = 0;

  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };

  const dialog = {
    open: false,
    showModal() { this.open = true; opened += 1; },
    close() { this.open = false; if (handlers.close) handlers.close(); },
    addEventListener(event, handler) { handlers[event] = handler; },
    querySelector(selector) {
      if (selector === "[data-review-invitation-close]") {
        return { addEventListener(event, handler) { handlers.dismiss = handler; } };
      }
      if (selector === "[data-review-invitation-link]") {
        return { addEventListener(event, handler) { handlers.link = handler; } };
      }
      return null;
    }
  };

  const client = {
    from(table) {
      assert.equal(table, "profiles");
      return { select() {
        return { eq(field, id) {
          assert.equal(field, "id");
          assert.equal(id, STUDENT_ID);
          return { maybeSingle: async () => ({ data: PROFILE, error: null }) };
        } };
      } };
    },
    async rpc(name, params) {
      if (name === "get_my_student_review") {
        return { data: { review: hasReview ? { status: "pending" } : null }, error: null };
      }
      assert.equal(name, "record_my_student_review_invitation");
      tracked.push(params.target_action);
      if (params.target_action === "shown" && failNextShown) {
        failNextShown = false;
        return { data: null, error: { message: "Synthetic network failure" } };
      }
      return { data: true, error: null };
    }
  };

  const options = { client, storage, dialog, studentId: STUDENT_ID };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    options, dialog, tracked, values, storage, flush,
    failFirstShown() { failNextShown = true; },
    markReviewed() { hasReview = true; },
    get opened() { return opened; }
  };
}

test("failed impression is saved locally and retried without reopening snoozed dialog", async () => {
  const fixture = harness();
  fixture.failFirstShown();

  assert.equal(await invitation.initialize(fixture.options), true);
  await fixture.flush();
  const pendingKey = EVENT_PREFIX + STUDENT_ID + ":shown";
  assert.ok(fixture.values.has(pendingKey), "failed event must be queued");
  assert.deepEqual(fixture.tracked, ["shown"]);

  fixture.dialog.close();
  await fixture.flush();
  assert.ok(fixture.values.has(SNOOZE_PREFIX + STUDENT_ID));
  assert.equal(await invitation.initialize(fixture.options), false);
  await fixture.flush();
  assert.equal(fixture.opened, 1, "the seven-day snooze still applies");
  assert.deepEqual(fixture.tracked, ["shown", "dismissed", "shown"]);
  assert.equal(fixture.values.has(pendingKey), false, "successful retry must clear the queue");
});

test("successful event leaves no local pending record", async () => {
  const fixture = harness();
  assert.equal(await invitation.initialize(fixture.options), true);
  await fixture.flush();
  assert.deepEqual(fixture.tracked, ["shown"]);
  assert.equal(fixture.values.has(EVENT_PREFIX + STUDENT_ID + ":shown"), false);
});

test("reviewed student is not shown the invitation and stale pending is cleared", async () => {
  const fixture = harness();
  fixture.storage.setItem(EVENT_PREFIX + STUDENT_ID + ":clicked", String(Date.now()));
  fixture.markReviewed();
  assert.equal(await invitation.initialize(fixture.options), false);
  await fixture.flush();
  assert.deepEqual(fixture.tracked, []);
  assert.equal(fixture.values.has(EVENT_PREFIX + STUDENT_ID + ":clicked"), false);
});

test("pending events older than a day are discarded, not misattributed as new impressions", async () => {
  const fixture = harness();
  fixture.storage.setItem(EVENT_PREFIX + STUDENT_ID + ":shown", String(Date.now() - 48 * 60 * 60 * 1000));
  fixture.storage.setItem(SNOOZE_PREFIX + STUDENT_ID, String(Date.now()));
  assert.equal(await invitation.initialize(fixture.options), false);
  await fixture.flush();
  assert.deepEqual(fixture.tracked, []);
  assert.equal(fixture.values.has(EVENT_PREFIX + STUDENT_ID + ":shown"), false);
});

test("storage failures cannot prevent dialog display or analytics request", async () => {
  const fixture = harness();
  fixture.options.storage = {
    getItem() { throw new Error("Storage disabled"); },
    setItem() { throw new Error("Storage disabled"); },
    removeItem() { throw new Error("Storage disabled"); }
  };
  assert.equal(await invitation.initialize(fixture.options), true);
  await fixture.flush();
  assert.deepEqual(fixture.tracked, ["shown"]);
});

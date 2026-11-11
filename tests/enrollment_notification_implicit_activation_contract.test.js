"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase/migrations/20261111152400_fix_enrollment_notification_implicit_activation.sql"
  ),
  "utf8"
);

const existingNotificationFunction = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase/migrations/20261021170211_administrative_student_enrollment.sql"
  ),
  "utf8"
);

test("enrollment notification trigger handles first enrollment on INSERT", () => {
  assert.match(
    migration,
    /create trigger queue_enrollment_email_notification_trigger\s+after insert on public\.profiles\s+for each row\s+when \(new\.enrolled is true\)/i
  );
});

test("enrollment notification detects a BEFORE UPDATE activation on profile completion", () => {
  assert.match(
    migration,
    /drop trigger if exists queue_enrollment_email_notification_trigger\s+on public\.profiles/i
  );
  assert.match(
    migration,
    /create trigger queue_enrollment_email_notification_on_activation\s+after update on public\.profiles\s+for each row\s+when \(\s*old\.enrolled is distinct from new\.enrolled\s+and new\.enrolled is true\s*\)/i
  );
  assert.doesNotMatch(migration, /after update of enrolled on public\.profiles/i);
});

test("enrollment notifications preserve portal-only scope and duplicate protection", () => {
  assert.match(existingNotificationFunction, /if new\.access_mode = 'administrative' then\s+return new;/i);
  assert.match(existingNotificationFunction, /on conflict \(student_id\) do nothing/i);
  assert.match(
    migration,
    /execute function public\.queue_enrollment_email_notification\(\)/gi
  );
});

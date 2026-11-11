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

test("production migration version alias is pinned to the exact SQL digest", () => {
  const { createHash } = require("node:crypto");
  const sqlDigest = createHash("sha256")
    .update(migration.trim())
    .digest("hex");
  const expectedDigest = "d35ef2347a5450bbd829939e602ecb2de56bb7bc322d9bdb37012e7400096dc6";
  assert.equal(sqlDigest, expectedDigest);
  const driftScript = fs.readFileSync(
    path.join(__dirname, "..", "scripts/check_supabase_migration_drift.sh"),
    "utf8"
  );
  assert.ok(
    driftScript.includes(
      `20261111152400|20261111152717|fix_enrollment_notification_implicit_activation|${expectedDigest}`
    )
  );
});

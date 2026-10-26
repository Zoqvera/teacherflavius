const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations",
    "20261026123500_realign_future_credits_on_class_transfer.sql"),
  "utf8"
);

test("class changes reconcile future credits in either transfer order", () => {
  assert.match(migration, /AFTER INSERT OR UPDATE OF class_number, user_id\s+ON public\.class_students/i);
  assert.match(migration, /AFTER DELETE ON public\.class_students/i);
  assert.match(migration, /linked\.created_at > old\.created_at/i);
  assert.match(migration, /remaining_count = 1/i);
});

test("previously used, cancelled, revoked and past lessons cannot be reassigned", () => {
  const reconciler = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION private.realign_future_contract_credits"),
    migration.indexOf("REVOKE ALL ON FUNCTION private.realign_future_contract_credits")
  );
  assert.match(reconciler, /credit\.credit_origin = 'contract'/);
  assert.match(reconciler, /credit\.status = 'scheduled'/);
  assert.match(reconciler, /credit\.revoked_at IS NULL/);
  assert.match(reconciler, /credit\.cancelled_at IS NULL/);
  assert.match(reconciler, /credit\.makeup_booking_id IS NULL/);
  assert.match(reconciler, /credit\.regular_starts_at > pg_catalog\.now\(\)/);
  assert.match(reconciler, /payment_date IS NOT NULL OR tuition\.is_exempt = true/);
  assert.doesNotMatch(reconciler, /DELETE FROM private\.lesson_credits/i);
  assert.doesNotMatch(reconciler, /UPDATE public\.monthly_tuition/i);
});

test("replacement class scheduling avoids duplicate purchases and cancellation dates", () => {
  assert.match(migration, /class\.class_weekday/);
  assert.match(migration, /membership\.first_lesson_date/);
  assert.match(migration, /class\.first_lesson_date/);
  assert.match(migration, /reserved\.regular_class_number = target_class_number/);
  assert.match(migration, /cancellation\.lesson_date/);
  assert.match(migration, /row_number\(\) OVER/i);
  assert.match(migration, /credits_moved <> credits_to_move/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
});

test("privileged reconciliation functions are not browser-callable", () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/i);
  for (const name of [
    "realign_future_contract_credits",
    "realign_credits_on_class_link",
    "realign_credits_after_old_class_removed"
  ]) {
    assert.match(
      migration,
      new RegExp("REVOKE ALL ON FUNCTION private\\." + name + "\\(", "i")
    );
  }
});

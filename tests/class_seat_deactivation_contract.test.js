const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    ROOT, "supabase", "migrations",
    "20261104024633_disable_class_seat_reservations.sql"
  ),
  "utf8"
);

test("deprecated reservation and waitlist writes remain blocked by triggers", () => {
  assert.match(migration, /create trigger reject_disabled_class_seat_hold/i);
  assert.match(migration, /before insert on private\.class_seat_holds/i);
  assert.match(migration, /create trigger reject_disabled_class_seat_waitlist/i);
  assert.match(migration, /before insert on private\.class_seat_waitlist/i);
  assert.match(migration, /raise exception 'A reserva de turmas foi desativada/i);
});

test("both public RPC overloads lose execution without blocking read-only availability", () => {
  assert.equal(
    (migration.match(/revoke execute on function public\.create_public_class_seat_hold\(/gi) || []).length,
    2
  );
  assert.equal(
    (migration.match(/revoke execute on function public\.join_public_class_seat_waitlist\(/gi) || []).length,
    2
  );
  assert.match(migration, /revoke execute on function public\.complete_my_reserved_seat_enrollment/i);
  assert.doesNotMatch(migration, /revoke execute on function public\.get_public_class_seat_availability/i);
  assert.match(migration, /keep public\.get_public_class_seat_availability\(\) as a read-only dependency/i);
});

test("unused submission budget SQL has been retired before production deployment", () => {
  assert.equal(fs.existsSync(path.join(
    ROOT, "supabase", "migrations",
    "20261104024500_throttle_public_class_seat_submission_attempts.sql"
  )), false);
  const securityDocs = fs.readFileSync(
    path.join(ROOT, "docs", "security-public-seat-budgets-20261104.md"), "utf8"
  );
  assert.match(securityDocs, /nunca foi aplicada em produção/i);
  assert.doesNotMatch(migration, /is_teacher_admin_mfa|aal2|monthly_tuition/i);
});

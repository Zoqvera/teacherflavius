const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261111195959_makeup_operational_occupancy_reporting_20261111.sql"),
  "utf8"
);
const adminScript = fs.readFileSync(path.join(ROOT, "reposicoes_admin.js"), "utf8");

test("teacher occupancy includes regular students, bookings and only recorded cancellations", () => {
  assert.match(migration, /create or replace function public\.get_teacher_makeup_slot_occupancy\(\)/i);
  assert.match(migration, /private\.get_class_operational_capacity\(slot\.class_number\)/i);
  assert.match(migration, /private\.count_class_seat_members\(context\.class_number\)/i);
  assert.match(migration, /private\.count_class_seat_holds\(context\.class_number\)/i);
  assert.match(migration, /private\.student_regular_lesson_cancellations cancellation/i);
  assert.match(migration, /booking\.status = 'confirmed'/i);
  assert.match(migration, /greatest\(0, totals\.capacity_limit - totals\.participants\)/i);
  assert.match(migration, /greatest\(0, totals\.participants - totals\.capacity_limit\)/i);
});

test("only authenticated teacher can query occupancy", () => {
  assert.match(migration, /if not public\.is_teacher_admin\(\) then/i);
  assert.match(migration, /revoke execute on function public\.get_teacher_makeup_slot_occupancy\(\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_teacher_makeup_slot_occupancy\(\)[\s\S]*to authenticated, service_role/i);
});

test("admin schedule never reports leftover makeup-only slots as free seats", () => {
  assert.match(adminScript, /client\.rpc\("get_teacher_makeup_slot_occupancy"\)/);
  assert.match(adminScript, /renderCapacitySummary\(slot, occupancy, active\)/);
  assert.match(adminScript, /occupancy\.regular_students/);
  assert.match(adminScript, /occupancy\.available_spots/);
  assert.match(adminScript, /occupancy\.over_capacity/);
  assert.doesNotMatch(adminScript, /confirmedCount \+ ' de ' \+ Number\(slot\.capacity\) \+ ' vagas reservadas'/);
});

test("already confirmed bookings are preserved during slot capacity correction", () => {
  assert.match(migration, /update public\.makeup_class_slots as slot/i);
  assert.match(migration, /slot\.capacity > private\.get_class_operational_capacity\(slot\.class_number\)/i);
  assert.doesNotMatch(migration, /delete from public\.makeup_class_bookings|update public\.makeup_class_bookings/i);
});

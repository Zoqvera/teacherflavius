import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateEnrollmentCheckout, evaluateCombinedCheckout } from "../supabase/functions/_shared/enrollment_checkout_policy.mjs";

const base = {
  enrolledAt: "2026-11-12T15:00:00Z",
  rolloutAt: "2026-11-12T14:00:00Z",
  billingStartMonth: "2026-11-01",
  invoiceMonth: "2026-12-01",
  firstPaymentDate: "2026-11-12",
  now: "2026-11-22T15:00:00Z",
};

test("legacy enrollments retain their existing policy", () => {
  assert.deepEqual(evaluateEnrollmentCheckout({ ...base, enrolledAt: "2026-11-11T15:00:00Z" }),
    { allowed: true, reason: "legacy_enrollment" });
});

test("first tuition is always manual, even after the waiting period", () => {
  assert.equal(evaluateEnrollmentCheckout({ ...base, invoiceMonth: "2026-11-01" }).reason,
    "first_tuition_manual");
});

test("both the first payment and ten full days are required", () => {
  assert.equal(evaluateEnrollmentCheckout({ ...base, firstPaymentDate: null }).reason, "first_tuition_unpaid");
  assert.equal(evaluateEnrollmentCheckout({ ...base, now: "2026-11-22T14:59:59Z" }).reason,
    "enrollment_waiting_period");
  assert.equal(evaluateEnrollmentCheckout(base).allowed, true);
  assert.equal(evaluateEnrollmentCheckout({ ...base, invoiceMonth: "2027-01-01" }).allowed, true);
});

test("invalid policy data fails closed", () => {
  assert.equal(evaluateEnrollmentCheckout({ ...base, rolloutAt: null }).allowed, false);
  assert.equal(evaluateEnrollmentCheckout({ ...base, invoiceMonth: null }).allowed, false);
});

test("all invoices in a combined payment must be eligible", () => {
  assert.equal(evaluateCombinedCheckout([base, { ...base, firstPaymentDate: null }]).allowed, false);
  assert.equal(evaluateCombinedCheckout([base, base]).allowed, true);
  assert.equal(evaluateCombinedCheckout([]).allowed, false);
  assert.equal(evaluateCombinedCheckout([base, null]).allowed, false);
});

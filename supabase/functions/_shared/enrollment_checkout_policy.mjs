const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

/** Evaluate one invoice against the post-rollout first-payment policy. */
export function evaluateEnrollmentCheckout({
  enrolledAt,
  rolloutAt,
  billingStartMonth,
  invoiceMonth,
  firstPaymentDate,
  now = Date.now(),
}) {
  const enrolled = Date.parse(enrolledAt);
  const rollout = Date.parse(rolloutAt);
  const currentTime = typeof now === "number" ? now : Date.parse(now);
  if (![enrolled, rollout, currentTime].every(Number.isFinite)) {
    return { allowed: false, reason: "policy_data_unavailable" };
  }
  if (enrolled < rollout) return { allowed: true, reason: "legacy_enrollment" };
  if (!/^\d{4}-\d{2}-01$/.test(billingStartMonth || "") ||
      !/^\d{4}-\d{2}-01$/.test(invoiceMonth || "")) {
    return { allowed: false, reason: "policy_data_unavailable" };
  }
  if (invoiceMonth <= billingStartMonth) {
    return { allowed: false, reason: "first_tuition_manual" };
  }
  if (!firstPaymentDate) return { allowed: false, reason: "first_tuition_unpaid" };
  if (currentTime < enrolled + TEN_DAYS_MS) {
    return { allowed: false, reason: "enrollment_waiting_period" };
  }
  return { allowed: true, reason: "eligible" };
}

/** A combined payment is allowed only when every invoice is eligible. */
export function evaluateCombinedCheckout(invoices) {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return { allowed: false, reason: "policy_data_unavailable" };
  }
  for (const invoice of invoices) {
    if (!invoice || typeof invoice !== "object") {
      return { allowed: false, reason: "policy_data_unavailable" };
    }
    const result = evaluateEnrollmentCheckout(invoice);
    if (!result.allowed) return result;
  }
  return { allowed: true, reason: "eligible" };
}

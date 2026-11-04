// The caller must construct this client with the request's own access token.
// A service-role client must never be used: the RPC authorizes auth.uid().
export async function recordAuthenticatedTuitionPayment(client, payment) {
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user?.id) {
    throw new Error("Sessão do professor inválida ou expirada.");
  }

  const { tuitionId, paymentDate, amountPaid, paymentMethod, notes } = payment;
  if (typeof tuitionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tuitionId)) {
    throw new Error("Mensalidade inválida.");
  }
  if (typeof paymentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new Error("Data de pagamento inválida.");
  }
  const date = new Date(`${paymentDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== paymentDate) {
    throw new Error("Data de pagamento inválida.");
  }
  if (typeof amountPaid !== "number" || !Number.isFinite(amountPaid) || amountPaid <= 0 || !Number.isSafeInteger(Math.round(amountPaid * 100)) || Math.abs(amountPaid * 100 - Math.round(amountPaid * 100)) > 1e-7) {
    throw new Error("Informe um valor positivo com até duas casas decimais.");
  }
  if (!["pix", "cash", "bank_transfer", "card", "other"].includes(paymentMethod)) {
    throw new Error("Forma de pagamento inválida.");
  }
  if (notes != null && (typeof notes !== "string" || notes.length > 1000)) {
    throw new Error("Observação inválida.");
  }

  const result = await client.rpc("record_tuition_payment", {
    target_tuition_id: tuitionId,
    target_payment_date: paymentDate,
    target_amount_paid: amountPaid,
    target_payment_method: paymentMethod,
    target_payment_notes: notes?.trim() || null,
  });
  if (result.error) throw result.error;
  if (result.data?.ok !== true) throw new Error("O pagamento não foi confirmado pelo sistema.");
  return result.data;
}

(function () {
  "use strict";

  const PAYMENT_WAITING_STATUSES = Object.freeze([
    "created",
    "pending",
    "authorized",
    "in_process",
    "in_mediation"
  ]);
  const UPCOMING_PAYMENT_STATUSES = Object.freeze([
    "due_in_two_days",
    "due_tomorrow",
    "due_today"
  ]);

  function formatCurrency(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "valor não informado";
  }

  function formatReferenceMonth(value) {
    const date = new Date(String(value || "") + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "mensalidade";
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }

  function formatDate(value) {
    const date = new Date(String(value || "") + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "data não informada";
    return date.toLocaleDateString("pt-BR");
  }

  function isPaymentWaiting(tuition) {
    return !!tuition.provider_payment_id && PAYMENT_WAITING_STATUSES.includes(tuition.attempt_status);
  }

  function hasPaymentWaiting(tuitions) {
    return tuitions.some(isPaymentWaiting);
  }

  function summarizeOverdueTuitions(tuitions) {
    const total = tuitions.reduce(function (sum, tuition) {
      return sum + (Number(tuition.amount_due) || 0);
    }, 0);
    const oldest = tuitions[0];
    const paymentWaiting = tuitions.some(isPaymentWaiting);

    if (tuitions.length === 1) {
      return {
        banner: (paymentWaiting ? "Pagamento aguardando confirmação: " : "Mensalidade vencida: ")
          + formatReferenceMonth(oldest.reference_month) + " · " + formatCurrency(oldest.amount_due) + ".",
        title: paymentWaiting ? "Pagamento aguardando confirmação" : "Você possui uma mensalidade vencida",
        description: "A mensalidade de " + formatReferenceMonth(oldest.reference_month)
          + ", no valor de " + formatCurrency(oldest.amount_due)
          + ", venceu em " + formatDate(oldest.due_date) + ".",
        total: total
      };
    }

    return {
      banner: tuitions.length + " mensalidades vencidas · total " + formatCurrency(total) + ".",
      title: "Você possui mensalidades vencidas",
      description: "Existem " + tuitions.length + " mensalidades vencidas, somando "
        + formatCurrency(total) + ". A cobrança mais antiga venceu em "
        + formatDate(oldest.due_date) + ".",
      total: total
    };
  }

  function summarizeUpcomingTuition(tuition) {
    let duePhrase = "vence em 2 dias";
    if (tuition.payment_status === "due_tomorrow") duePhrase = "vence amanhã";
    if (tuition.payment_status === "due_today") duePhrase = "vence hoje";

    return {
      banner: "Atenção: sua mensalidade de " + formatCurrency(tuition.amount_due)
        + " " + duePhrase + ", em " + formatDate(tuition.due_date) + "."
    };
  }

  function summarizePaymentWaiting(tuition) {
    return {
      banner: "Pagamento aguardando confirmação: " + formatReferenceMonth(tuition.reference_month)
        + " · " + formatCurrency(tuition.amount_due) + "."
    };
  }

  function createNotice(tuitions) {
    const overdueTuitions = tuitions.filter(function (tuition) {
      return tuition.payment_status === "overdue";
    });

    if (overdueTuitions.length) {
      return Object.freeze({
        tone: "overdue",
        summary: summarizeOverdueTuitions(overdueTuitions),
        modalTuition: overdueTuitions[0]
      });
    }

    const upcomingTuition = tuitions.find(function (tuition) {
      return UPCOMING_PAYMENT_STATUSES.includes(tuition.payment_status);
    });

    if (upcomingTuition) {
      return Object.freeze({
        tone: "warning",
        summary: summarizeUpcomingTuition(upcomingTuition),
        modalTuition: null
      });
    }

    const waitingTuition = tuitions.find(isPaymentWaiting);
    if (!waitingTuition) return null;

    return Object.freeze({
      tone: "warning",
      summary: summarizePaymentWaiting(waitingTuition),
      modalTuition: null
    });
  }

  window.StudentPaymentNoticePresenter = Object.freeze({
    hasPaymentWaiting: hasPaymentWaiting,
    createNotice: createNotice
  });
})();

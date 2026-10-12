(function () {
  "use strict";

  const panel = document.getElementById("lessonCreditAudit");
  const content = document.getElementById("lessonCreditAuditContent");
  const refreshButton = document.getElementById("refreshCreditAuditButton");
  if (!panel || !content || !refreshButton) return;

  const REASONS = Object.freeze({
    revoked_confirmed_booking: "Revogado com reserva confirmada — intervenção necessária",
    revoked_unpaid: "Revogação prevista: mensalidade não quitada",
    revoked_excess: "Revogação prevista: crédito acima do plano atual",
    revoked_review: "Revogação a revisar",
    active_unpaid: "Crédito ativo sem mensalidade quitada — intervenção necessária",
    active_excess: "Crédito ativo acima do plano atual — revisar direitos anteriores"
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMonth(value) {
    const parts = String(value || "").split("-");
    if (parts.length !== 3) return "Competência não informada";
    return parts[1] + "/" + parts[0];
  }

  function formatRevocation(value) {
    if (!value) return "Não revogado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data de revogação indisponível";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(date);
  }

  function summaryMetric(label, count) {
    return '<div class="credit-audit-metric"><strong>' +
      escapeHtml(Number(count || 0)) + '</strong><span>' + escapeHtml(label) +
      '</span></div>';
  }

  function renderRow(credit) {
    const revoked = Boolean(credit.revoked_at);
    const status = revoked ? "Revogado" : credit.effective_status;
    const reason = REASONS[credit.classification] || "Revisar crédito";
    const critical = ["revoked_confirmed_booking", "active_unpaid"].includes(credit.classification);
    const statusClass = revoked ? "danger" : (critical ? "danger" : "warning");

    return '<article class="credit-audit-row">' +
      '<div><strong>' + escapeHtml(credit.student_name || "Aluno") + '</strong>' +
      '<p>Competência ' + escapeHtml(formatMonth(credit.reference_month)) +
      ' · Crédito ' + escapeHtml(credit.credit_number) +
      ' · Estado original: ' + escapeHtml(credit.original_status) + '</p>' +
      '<p>' + escapeHtml(reason) + '</p>' +
      (revoked ? '<p>Revogado em ' + escapeHtml(formatRevocation(credit.revoked_at)) + '</p>' : '') +
      '</div><span class="status-pill ' + statusClass + '">' + escapeHtml(status) + '</span>' +
      '</article>';
  }

  function renderAudit(snapshot) {
    const summary = snapshot.summary || {};
    const credits = Array.isArray(snapshot.credits) ? snapshot.credits : [];
    const risks = Number(summary.revoked_confirmed_booking || 0) +
      Number(summary.active_unpaid || 0);
    const reviews = Number(summary.revoked_review || 0) +
      Number(summary.active_excess || 0);

    const metrics = [
      summaryMetric("Revogações registradas", summary.revoked_total),
      summaryMetric("Revogações esperadas: sem pagamento", summary.revoked_unpaid),
      summaryMetric("Revogações esperadas: redução de plano", summary.revoked_excess),
      summaryMetric("Exigem revisão", reviews),
      summaryMetric("Inconsistências críticas", risks)
    ].join("");

    content.innerHTML =
      '<p class="credit-audit-explanation">A data de revogação prevalece sobre o estado histórico do crédito. ' +
      'Créditos acima do plano atual exigem análise contratual antes de qualquer mudança.</p>' +
      '<div class="credit-audit-summary">' + metrics + '</div>' +
      '<details class="credit-audit-details"><summary>Consultar créditos auditados (' +
      escapeHtml(credits.length) + ' exibidos; limite de ' +
      escapeHtml(snapshot.details_limit || 100) + ')</summary>' +
      '<div class="credit-audit-records">' +
      (credits.length ? credits.map(renderRow).join("") :
        '<p class="empty">Nenhum crédito necessita de classificação especial.</p>') +
      '</div></details>';
  }

  async function refreshAudit() {
    refreshButton.disabled = true;
    content.textContent = "Verificando créditos...";
    try {
      if (!window.Auth || !Auth.isConfigured()) throw new Error("Autenticação indisponível.");
      const session = await Auth.getSession();
      if (!session || !session.user) return;
      const admin = await Auth.getClient().rpc("is_teacher_admin");
      if (admin.error) throw admin.error;
      if (admin.data !== true) return;

      panel.hidden = false;
      const result = await Auth.getClient().rpc("get_teacher_lesson_credit_audit");
      if (result.error) throw result.error;
      renderAudit(result.data || {});
    } catch (error) {
      panel.hidden = false;
      content.textContent = "Não foi possível consultar a auditoria de créditos: " +
        (error.message || "tente novamente.");
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", refreshAudit);
  refreshAudit();
})();

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PaymentChargebackDocumentation = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PANEL_ID = "paymentChargebackDocumentation";
  const STYLE_ID = "paymentChargebackDocumentationStyles";
  const FUNCTION_NAME = "manage-mercado-pago-chargeback-documentation";
  const SUBMISSION_CONFIRMATION = "DOCUMENTAÇÃO ENVIADA";

  const PREPARATION_LABELS = Object.freeze({
    not_started: "Não iniciada",
    collecting: "Coletando evidências",
    ready: "Pronta para envio",
    submitted: "Envio marcado",
    closed: "Encerrada"
  });
  const CATEGORY_LABELS = Object.freeze({
    service_delivery: "Prova de prestação do serviço",
    terms_acceptance: "Aceite de termos/contratação",
    customer_communication: "Comunicação com o cliente",
    payment_receipt: "Comprovante de pagamento",
    identity_or_order_reference: "Referência de pedido/identificação",
    other: "Outro"
  });
  const EVIDENCE_LABELS = Object.freeze({
    needed: "Necessária",
    collected: "Coletada",
    verified: "Verificada",
    included: "Incluir no envio"
  });

  function text(value) {
    return value == null ? "" : String(value);
  }

  function valueFrom(source, snakeName, camelName) {
    if (!source || typeof source !== "object") return undefined;
    return source[snakeName] !== undefined ? source[snakeName] : source[camelName];
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function optionMarkup(labels, selected) {
    return Object.keys(labels).map(function (value) {
      return '<option value="' + value + '"' + (value === selected ? " selected" : "") + '>' +
        escapeHtml(labels[value]) + '</option>';
    }).join("");
  }

  function formatDate(value) {
    if (!value) return "Não informado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Não informado";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function deadlineState(deadline, nowValue) {
    if (!deadline) return { tone: "neutral", label: "Prazo não informado", expired: false, hours: null };
    const target = new Date(deadline).getTime();
    const now = nowValue == null ? Date.now() : Number(nowValue);
    if (!Number.isFinite(target) || !Number.isFinite(now)) {
      return { tone: "neutral", label: "Prazo inválido", expired: false, hours: null };
    }
    const hours = Math.floor((target - now) / 3600000);
    if (hours < 0) return { tone: "critical", label: "Prazo expirado", expired: true, hours: hours };
    if (hours <= 24) return { tone: "critical", label: "Menos de 24h", expired: false, hours: hours };
    if (hours <= 72) return { tone: "warning", label: "Menos de 72h", expired: false, hours: hours };
    return { tone: "healthy", label: "Prazo em aberto", expired: false, hours: hours };
  }

  function normalizeEvidence(items) {
    return (Array.isArray(items) ? items : []).map(function (item) {
      const category = text(item && item.category);
      const status = text(item && item.status);
      return {
        id: text(item && item.id),
        category: CATEGORY_LABELS[category] ? category : "other",
        label: text(item && item.label),
        notes: text(item && item.notes),
        status: EVIDENCE_LABELS[status] ? status : "needed",
        updatedAt: text(valueFrom(item, "updated_at", "updatedAt"))
      };
    }).filter(function (item) { return item.id && item.label; });
  }

  function normalizeEvents(items) {
    return (Array.isArray(items) ? items : []).map(function (event) {
      return {
        action: text(event && event.action),
        details: event && event.details,
        createdAt: text(valueFrom(event, "created_at", "createdAt"))
      };
    });
  }

  function normalizeCasePayload(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const rawCase = source.case && typeof source.case === "object" ? source.case : source;
    const preparationStatus = text(valueFrom(rawCase, "preparation_status", "preparationStatus"));
    return {
      chargebackId: text(valueFrom(rawCase, "chargeback_id", "chargebackId")),
      providerChargebackId: text(valueFrom(rawCase, "provider_chargeback_id", "providerChargebackId")),
      documentationStatus: text(valueFrom(rawCase, "documentation_status", "documentationStatus")),
      documentationDeadline: text(valueFrom(rawCase, "documentation_deadline", "documentationDeadline")),
      operationalStatus: text(valueFrom(rawCase, "operational_status", "operationalStatus")),
      preparationStatus: PREPARATION_LABELS[preparationStatus] ? preparationStatus : "not_started",
      internalNotes: text(valueFrom(rawCase, "internal_notes", "internalNotes")),
      submissionMarkedAt: text(valueFrom(rawCase, "submission_marked_at", "submissionMarkedAt")),
      evidence: normalizeEvidence(source.evidence),
      events: normalizeEvents(source.events)
    };
  }

  function canMarkSubmitted(caseData, nowValue) {
    const state = deadlineState(caseData.documentationDeadline, nowValue);
    return caseData.operationalStatus === "open" &&
      caseData.documentationStatus === "pending" &&
      !state.expired &&
      caseData.preparationStatus === "ready" &&
      caseData.evidence.some(function (item) { return item.status === "included"; });
  }

  function evidenceMarkup(item) {
    return '<article class="cb-doc-evidence" data-evidence-id="' + escapeHtml(item.id) + '">' +
      '<div class="cb-doc-evidence-grid">' +
      '<label>Categoria<select data-evidence-category disabled>' + optionMarkup(CATEGORY_LABELS, item.category) + '</select></label>' +
      '<label>Status<select data-evidence-status>' + optionMarkup(EVIDENCE_LABELS, item.status) + '</select></label>' +
      '</div>' +
      '<label>Descrição<input type="text" maxlength="180" data-evidence-label value="' + escapeHtml(item.label) + '"></label>' +
      '<label>Notas<textarea maxlength="2000" rows="2" data-evidence-notes>' + escapeHtml(item.notes) + '</textarea></label>' +
      '<div class="cb-doc-actions"><button type="button" data-doc-action="save-evidence">SALVAR EVIDÊNCIA</button>' +
      '<button type="button" class="danger" data-doc-action="delete-evidence">REMOVER</button></div>' +
      '</article>';
  }

  function eventMarkup(event) {
    const labels = {
      case_updated: "Caso atualizado",
      evidence_added: "Evidência adicionada",
      evidence_updated: "Evidência atualizada",
      evidence_removed: "Evidência removida",
      submission_marked: "Envio marcado internamente"
    };
    return '<li><strong>' + escapeHtml(labels[event.action] || event.action) + '</strong><span>' +
      escapeHtml(formatDate(event.createdAt)) + '</span></li>';
  }

  function buildMarkup(raw) {
    const caseData = normalizeCasePayload(raw);
    const deadline = deadlineState(caseData.documentationDeadline);
    const evidence = caseData.evidence.length
      ? caseData.evidence.map(evidenceMarkup).join("")
      : '<p class="cb-doc-empty">Nenhuma evidência cadastrada.</p>';
    const history = caseData.events.length
      ? '<ul class="cb-doc-history">' + caseData.events.slice(0, 12).map(eventMarkup).join("") + '</ul>'
      : '<p class="cb-doc-empty">Ainda não há histórico interno.</p>';
    const submissionDisabled = canMarkSubmitted(caseData) ? "" : " disabled";

    return '<section class="cb-doc-panel" aria-labelledby="cb-doc-title" data-chargeback-id="' + escapeHtml(caseData.chargebackId) + '">' +
      '<div class="cb-doc-heading"><div><span>DOCUMENTAÇÃO DA CONTESTAÇÃO</span><h2 id="cb-doc-title">Caso ' + escapeHtml(caseData.providerChargebackId) + '</h2></div>' +
      '<button type="button" class="secondary" data-doc-action="close">FECHAR</button></div>' +
      '<div class="cb-doc-provider-grid">' +
      '<div><small>Mercado Pago</small><strong>' + escapeHtml(caseData.documentationStatus || "não informado") + '</strong></div>' +
      '<div><small>Prazo</small><strong>' + escapeHtml(formatDate(caseData.documentationDeadline)) + '</strong><span class="deadline ' + deadline.tone + '">' + escapeHtml(deadline.label) + '</span></div>' +
      '<div><small>Envio interno</small><strong>' + escapeHtml(caseData.submissionMarkedAt ? formatDate(caseData.submissionMarkedAt) : "não marcado") + '</strong></div>' +
      '</div>' +
      '<p class="cb-doc-warning">Este painel não envia arquivos ao Mercado Pago. Ele organiza o checklist e registra o envio realizado externamente.</p>' +
      '<div class="cb-doc-section"><h3>Preparação interna</h3>' +
      '<div class="cb-doc-case-grid"><label>Status<select data-case-status>' + optionMarkup(PREPARATION_LABELS, caseData.preparationStatus) + '</select></label>' +
      '<label class="notes">Notas internas<textarea rows="3" maxlength="4000" data-case-notes>' + escapeHtml(caseData.internalNotes) + '</textarea></label></div>' +
      '<div class="cb-doc-actions"><button type="button" data-doc-action="save-case">SALVAR PREPARAÇÃO</button></div></div>' +
      '<div class="cb-doc-section"><h3>Checklist de evidências</h3>' + evidence + '</div>' +
      '<div class="cb-doc-section cb-doc-add"><h3>Adicionar evidência</h3>' +
      '<div class="cb-doc-evidence-grid"><label>Categoria<select data-new-category>' + optionMarkup(CATEGORY_LABELS, "service_delivery") + '</select></label>' +
      '<label>Descrição<input type="text" maxlength="180" data-new-label placeholder="Ex.: registro das aulas realizadas"></label></div>' +
      '<label>Notas<textarea rows="2" maxlength="2000" data-new-notes></textarea></label>' +
      '<div class="cb-doc-actions"><button type="button" data-doc-action="add-evidence">ADICIONAR AO CHECKLIST</button></div></div>' +
      '<div class="cb-doc-section cb-doc-submit"><h3>Registro de envio</h3>' +
      '<p>Use somente depois de enviar os arquivos diretamente ao Mercado Pago. O botão fica disponível apenas quando o provedor está em <code>pending</code>, o caso está pronto, o prazo não expirou e há evidência marcada para inclusão.</p>' +
      '<button type="button" data-doc-action="mark-submitted"' + submissionDisabled + '>MARCAR COMO ENVIADA EXTERNAMENTE</button></div>' +
      '<div class="cb-doc-section"><h3>Histórico interno</h3>' + history + '</div>' +
      '<p class="cb-doc-message" role="status" aria-live="polite" data-doc-message></p>' +
      '</section>';
  }

  function installStyles(documentRef) {
    if (!documentRef || documentRef.getElementById(STYLE_ID)) return;
    const style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".cb-doc-panel{margin:20px 0;padding:22px;border:2px solid #d0d5dd;border-radius:16px;background:#fcfcfd;color:#172033}",
      ".cb-doc-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.cb-doc-heading span{font-size:11px;font-weight:800;letter-spacing:.12em;color:#667085}.cb-doc-heading h2{margin:4px 0 0;font-size:20px}",
      ".cb-doc-provider-grid,.cb-doc-case-grid,.cb-doc-evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.cb-doc-provider-grid{margin:18px 0}.cb-doc-provider-grid>div{padding:12px;border:1px solid #eaecf0;border-radius:10px;background:#fff}.cb-doc-provider-grid small{display:block;color:#667085;margin-bottom:4px}.cb-doc-provider-grid strong{display:block}",
      ".deadline{display:inline-block;margin-top:5px;padding:3px 6px;border-radius:999px;font-size:10px;font-weight:800}.deadline.healthy{background:#ecfdf3;color:#027a48}.deadline.warning{background:#fff4e5;color:#b54708}.deadline.critical{background:#fff1f3;color:#c01048}.deadline.neutral{background:#f2f4f7;color:#475467}",
      ".cb-doc-warning{padding:10px 12px;border-radius:9px;background:#fff8e7;color:#7a2e0e;font-size:13px}.cb-doc-section{margin-top:20px;padding-top:18px;border-top:1px solid #eaecf0}.cb-doc-section h3{margin:0 0 12px;font-size:15px}.cb-doc-panel label{display:block;font-size:12px;font-weight:700;color:#344054}.cb-doc-panel input,.cb-doc-panel select,.cb-doc-panel textarea{box-sizing:border-box;width:100%;margin-top:5px;padding:9px 10px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;font:inherit;color:#172033}.cb-doc-case-grid .notes{grid-column:span 2}",
      ".cb-doc-evidence{margin:10px 0;padding:14px;border:1px solid #e4e7ec;border-radius:10px;background:#fff}.cb-doc-evidence-grid{grid-template-columns:1fr 1fr}.cb-doc-evidence label+label,.cb-doc-evidence>label{margin-top:10px}.cb-doc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.cb-doc-actions button,.cb-doc-submit button,.cb-doc-heading button{border:0;border-radius:8px;padding:9px 11px;font-size:11px;font-weight:800;background:#172033;color:#fff;cursor:pointer}.cb-doc-actions button.danger{background:#b42318}.cb-doc-heading button.secondary{background:#f2f4f7;color:#344054}.cb-doc-panel button:disabled{opacity:.45;cursor:not-allowed}",
      ".cb-doc-submit p,.cb-doc-empty{font-size:13px;color:#667085}.cb-doc-history{list-style:none;padding:0;margin:0}.cb-doc-history li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #f2f4f7;font-size:12px}.cb-doc-history span{color:#667085}.cb-doc-message{min-height:20px;font-size:13px;font-weight:700}.cb-doc-message.error{color:#b42318}.cb-doc-message.success{color:#027a48}",
      "@media(max-width:760px){.cb-doc-provider-grid,.cb-doc-case-grid,.cb-doc-evidence-grid{grid-template-columns:1fr}.cb-doc-case-grid .notes{grid-column:auto}.cb-doc-heading{display:block}.cb-doc-heading button{margin-top:10px}}"
    ].join("");
    documentRef.head.appendChild(style);
  }

  async function invoke(windowRef, body) {
    const response = await windowRef.Auth.getClient().functions.invoke(FUNCTION_NAME, { body: body });
    if (response.error) throw response.error;
    if (!response.data || response.data.ok !== true) throw new Error("Resposta inválida do serviço de documentação.");
    return response.data.result;
  }

  function setMessage(panel, message, tone) {
    const target = panel && panel.querySelector("[data-doc-message]");
    if (!target) return;
    target.className = "cb-doc-message " + (tone || "");
    target.textContent = message || "";
  }

  function render(documentRef, payload) {
    let container = documentRef.getElementById(PANEL_ID);
    if (!container) {
      container = documentRef.createElement("div");
      container.id = PANEL_ID;
      const anchor = documentRef.getElementById("paymentChargebackOperations");
      if (!anchor || !anchor.parentNode) return null;
      anchor.parentNode.insertBefore(container, anchor.nextSibling);
    }
    container.innerHTML = buildMarkup(payload);
    return container.firstElementChild;
  }

  async function openCase(dependencies, chargebackId) {
    const payload = await invoke(dependencies.windowRef, { action: "get_case", chargeback_id: chargebackId });
    const panel = render(dependencies.documentRef, payload);
    if (panel && typeof panel.scrollIntoView === "function") panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function currentChargebackId(panel) {
    return panel ? text(panel.dataset.chargebackId) : "";
  }

  async function refreshAfterCommand(dependencies, body, chargebackId) {
    await invoke(dependencies.windowRef, body);
    await openCase(dependencies, chargebackId);
  }

  async function handleCaseSave(dependencies, panel) {
    const chargebackId = currentChargebackId(panel);
    await refreshAfterCommand(dependencies, {
      action: "save_case",
      chargeback_id: chargebackId,
      preparation_status: panel.querySelector("[data-case-status]").value,
      internal_notes: panel.querySelector("[data-case-notes]").value
    }, chargebackId);
  }

  async function handleEvidenceAdd(dependencies, panel) {
    const chargebackId = currentChargebackId(panel);
    const label = panel.querySelector("[data-new-label]").value.trim();
    if (!label) throw new Error("Informe a descrição da evidência.");
    await refreshAfterCommand(dependencies, {
      action: "add_evidence",
      chargeback_id: chargebackId,
      category: panel.querySelector("[data-new-category]").value,
      label: label,
      notes: panel.querySelector("[data-new-notes]").value
    }, chargebackId);
  }

  async function handleEvidenceUpdate(dependencies, panel, button) {
    const chargebackId = currentChargebackId(panel);
    const item = button.closest("[data-evidence-id]");
    await refreshAfterCommand(dependencies, {
      action: "update_evidence",
      evidence_id: item.dataset.evidenceId,
      status: item.querySelector("[data-evidence-status]").value,
      label: item.querySelector("[data-evidence-label]").value,
      notes: item.querySelector("[data-evidence-notes]").value
    }, chargebackId);
  }

  async function handleEvidenceDelete(dependencies, panel, button) {
    if (!dependencies.windowRef.confirm("Remover esta evidência do checklist?")) return;
    const chargebackId = currentChargebackId(panel);
    const item = button.closest("[data-evidence-id]");
    await refreshAfterCommand(dependencies, {
      action: "delete_evidence",
      evidence_id: item.dataset.evidenceId
    }, chargebackId);
  }

  async function handleSubmission(dependencies, panel) {
    const confirmed = dependencies.windowRef.confirm(
      "Confirme somente se os arquivos já foram enviados diretamente ao Mercado Pago. Este botão NÃO envia documentos."
    );
    if (!confirmed) return;
    const chargebackId = currentChargebackId(panel);
    await refreshAfterCommand(dependencies, {
      action: "mark_submitted",
      chargeback_id: chargebackId,
      confirmation: SUBMISSION_CONFIRMATION
    }, chargebackId);
  }

  async function handleAction(dependencies, event) {
    const button = event.target.closest && event.target.closest("[data-doc-action]");
    if (!button) return;
    const panel = button.closest(".cb-doc-panel");
    if (!panel) return;
    const action = button.dataset.docAction;
    if (action === "close") {
      const container = dependencies.documentRef.getElementById(PANEL_ID);
      if (container) container.innerHTML = "";
      return;
    }

    button.disabled = true;
    setMessage(panel, "Processando…", "");
    try {
      if (action === "save-case") await handleCaseSave(dependencies, panel);
      else if (action === "add-evidence") await handleEvidenceAdd(dependencies, panel);
      else if (action === "save-evidence") await handleEvidenceUpdate(dependencies, panel, button);
      else if (action === "delete-evidence") await handleEvidenceDelete(dependencies, panel, button);
      else if (action === "mark-submitted") await handleSubmission(dependencies, panel);
      setMessage(dependencies.documentRef.querySelector(".cb-doc-panel"), "Atualização registrada.", "success");
    } catch (error) {
      setMessage(panel, error && error.message ? error.message : "Não foi possível atualizar a documentação.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function bindManagementButtons(dependencies) {
    dependencies.documentRef.addEventListener("click", function (event) {
      const manage = event.target.closest && event.target.closest("[data-chargeback-manage]");
      if (!manage) return;
      openCase(dependencies, manage.dataset.chargebackCaseId).catch(function (error) {
        console.warn("Não foi possível abrir a documentação da contestação.", error);
      });
    });
    dependencies.documentRef.addEventListener("click", function (event) {
      handleAction(dependencies, event).catch(function (error) {
        console.warn("Não foi possível processar a documentação da contestação.", error);
      });
    });
  }

  function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    installStyles(documentRef);
    bindManagementButtons({ windowRef: windowRef, documentRef: documentRef });
    return true;
  }

  return Object.freeze({
    deadlineState: deadlineState,
    normalizeCasePayload: normalizeCasePayload,
    canMarkSubmitted: canMarkSubmitted,
    buildMarkup: buildMarkup,
    initialize: initialize
  });
});

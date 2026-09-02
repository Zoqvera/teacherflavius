let currentAdminSession = null;
let billingStudents = [];
let monthlyTuition = [];
let selectedStudentId = null;
let selectedTuitionId = null;

const paymentMethodLabels = {
  pix: "PIX",
  cash: "Dinheiro",
  bank_transfer: "Transferência",
  card: "Cartão",
  other: "Outro"
};

const statusMetadata = {
  paid: { label: "Pago", className: "status-paid" },
  exempt: { label: "Isento", className: "status-exempt" },
  due_soon: { label: "A vencer", className: "status-due-soon" },
  overdue: { label: "Atrasado", className: "status-overdue" },
  open: { label: "Em aberto", className: "status-open" }
};

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitForAuthResources() {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
    await sleep(150);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
}

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("mensalidades.html");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function dateToInputValue(date) {
  return [date.getFullYear(), padNumber(date.getMonth() + 1), padNumber(date.getDate())].join("-");
}

function currentMonthValue() {
  const now = new Date();
  return now.getFullYear() + "-" + padNumber(now.getMonth() + 1);
}

function getSelectedReferenceMonth() {
  const value = document.getElementById("referenceMonth").value || currentMonthValue();
  return value + "-01";
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(number);
}

function formatDate(value) {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length !== 3) return value;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function formatReferenceMonth(value) {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length < 2) return value;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  const formatted = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function getStatusMeta(status) {
  return statusMetadata[status] || statusMetadata.open;
}

function setPageMessage(message, type) {
  const element = document.getElementById("pageMessage");
  if (!element) return;
  element.textContent = message || "";
  element.className = "page-message" + (type ? " " + type : "");
  element.hidden = !message;
}

function setFormMessage(id, message, type) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message || "";
  element.className = "form-message" + (type ? " " + type : "");
  element.hidden = !message;
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel || "PROCESSANDO...";
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || button.textContent;
  }
}

async function assertAdminAccess() {
  const client = Auth.getClient();
  const response = await client.rpc("is_teacher_admin");
  if (response.error) throw response.error;
  return response.data === true;
}

async function reconcileMercadoPagoPayments() {
  const response = await Auth.getClient().functions.invoke("reconcile-mercado-pago-payments", {
    body: {}
  });
  if (response.error) throw response.error;
  return response.data || {};
}

async function loadBillingStudents() {
  const response = await Auth.getClient().rpc("get_teacher_billing_students");
  if (response.error) throw response.error;
  billingStudents = response.data || [];
  renderBillingStudents();
}

async function generateSelectedMonth() {
  const response = await Auth.getClient().rpc("generate_monthly_tuition", {
    target_reference_month: getSelectedReferenceMonth()
  });
  if (response.error) throw response.error;
  return Number(response.data || 0);
}

async function loadSelectedMonth(options) {
  const shouldGenerate = !options || options.generate !== false;
  const refreshButton = document.getElementById("refreshMonthButton");
  setButtonBusy(refreshButton, true, "ATUALIZANDO...");
  setPageMessage("Carregando mensalidades...", "info");

  try {
    if (shouldGenerate) await generateSelectedMonth();
    const response = await Auth.getClient().rpc("get_teacher_monthly_tuition", {
      target_reference_month: getSelectedReferenceMonth()
    });
    if (response.error) throw response.error;
    monthlyTuition = response.data || [];
    renderDashboard();
    setPageMessage("", "");
  } catch (error) {
    monthlyTuition = [];
    renderDashboard();
    setPageMessage(
      "Não foi possível carregar as mensalidades: " + (error.message || "erro desconhecido") +
      ". Execute supabase_mensalidades.sql no Supabase.",
      "error"
    );
  } finally {
    setButtonBusy(refreshButton, false);
  }
}

function updateSummaryCards() {
  const received = monthlyTuition
    .filter(function (item) { return item.payment_status === "paid"; })
    .reduce(function (total, item) { return total + Number(item.amount_paid || 0); }, 0);

  const counts = monthlyTuition.reduce(function (result, item) {
    const status = item.payment_status || "open";
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});

  document.getElementById("summaryReceived").textContent = formatCurrency(received);
  document.getElementById("summaryPaid").textContent = String(counts.paid || 0);
  document.getElementById("summaryExempt").textContent = String(counts.exempt || 0);
  document.getElementById("summaryDueSoon").textContent = String(counts.due_soon || 0);
  document.getElementById("summaryOverdue").textContent = String(counts.overdue || 0);
}

function getFilteredTuition() {
  const search = document.getElementById("studentSearch").value.trim().toLocaleLowerCase("pt-BR");
  const status = document.getElementById("statusFilter").value;

  return monthlyTuition.filter(function (item) {
    const searchable = (String(item.student_name || "") + " " + String(item.student_email || ""))
      .toLocaleLowerCase("pt-BR");
    const matchesSearch = !search || searchable.includes(search);
    const matchesStatus = status === "all" || item.payment_status === status;
    return matchesSearch && matchesStatus;
  });
}

function getPaymentDescription(item) {
  if (item.payment_status === "exempt") {
    return item.payment_notes
      ? "Isenta · " + escapeHtml(item.payment_notes)
      : "Isenta";
  }
  if (!item.payment_date) return "—";
  return formatDate(item.payment_date) + " · " +
    escapeHtml(paymentMethodLabels[item.payment_method] || item.payment_method || "");
}

function getTuitionActions(item) {
  const tuitionId = escapeHtml(item.tuition_id);
  if (item.payment_status === "paid") {
    return '<button class="table-action danger" type="button" data-action="reverse" data-tuition-id="' + tuitionId + '">ESTORNAR</button>';
  }
  if (item.payment_status === "exempt") {
    return '<button class="table-action" type="button" data-action="remove-exemption" data-tuition-id="' + tuitionId + '">REMOVER ISENÇÃO</button>';
  }
  return '<button class="table-action success" type="button" data-action="pay" data-tuition-id="' + tuitionId + '">REGISTRAR</button>' +
    '<button class="table-action" type="button" data-action="exempt" data-tuition-id="' + tuitionId + '">ISENTAR</button>';
}

function renderTuitionTable() {
  const body = document.getElementById("tuitionTableBody");
  const empty = document.getElementById("tuitionEmptyState");
  const filtered = getFilteredTuition();

  if (!filtered.length) {
    body.innerHTML = "";
    empty.hidden = false;
    empty.textContent = monthlyTuition.length
      ? "Nenhuma mensalidade corresponde aos filtros selecionados."
      : "Nenhuma mensalidade foi gerada para este mês. Configure os alunos abaixo para iniciar.";
    return;
  }

  empty.hidden = true;
  body.innerHTML = filtered.map(function (item) {
    const status = getStatusMeta(item.payment_status);
    const paymentDescription = getPaymentDescription(item);
    const tuitionActions = getTuitionActions(item);

    return '<tr>' +
      '<td><strong>' + escapeHtml(item.student_name || "Aluno") + '</strong><small>' + escapeHtml(item.student_email || "") + '</small></td>' +
      '<td>' + escapeHtml(formatReferenceMonth(item.reference_month)) + '</td>' +
      '<td>' + escapeHtml(formatDate(item.due_date)) + '</td>' +
      '<td>' + escapeHtml(formatCurrency(item.amount_due)) + '</td>' +
      '<td>' + paymentDescription + '</td>' +
      '<td><span class="status-pill ' + status.className + '">' + status.label + '</span></td>' +
      '<td><div class="table-actions">' + tuitionActions +
        '<button class="table-action" type="button" data-action="history" data-student-id="' + escapeHtml(item.student_id) + '">HISTÓRICO</button>' +
      '</div></td>' +
    '</tr>';
  }).join("");
}

function renderDashboard() {
  updateSummaryCards();
  renderTuitionTable();
  document.getElementById("exportButton").disabled = getFilteredTuition().length === 0;
}

function renderBillingStudents() {
  const body = document.getElementById("billingStudentsBody");
  const empty = document.getElementById("billingStudentsEmpty");
  const configured = billingStudents.filter(function (student) { return student.monthly_fee != null; }).length;

  document.getElementById("configuredStudentsCount").textContent = configured + " de " + billingStudents.length + " configurados";

  if (!billingStudents.length) {
    body.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "Nenhum aluno matriculado foi encontrado.";
    return;
  }

  empty.hidden = true;
  body.innerHTML = billingStudents.map(function (student) {
    const configuredStudent = student.monthly_fee != null;
    const active = student.billing_active === true;
    const statusLabel = !configuredStudent ? "Não configurado" : (active ? "Ativo" : "Suspenso");
    const statusClass = !configuredStudent ? "status-open" : (active ? "status-paid" : "status-overdue");

    return '<tr>' +
      '<td><strong>' + escapeHtml(student.name || "Aluno") + '</strong><small>' + escapeHtml(student.email || "") + '</small></td>' +
      '<td>' + (configuredStudent ? escapeHtml(formatCurrency(student.monthly_fee)) : "—") + '</td>' +
      '<td>' + (configuredStudent ? "Dia " + escapeHtml(student.due_day) : "—") + '</td>' +
      '<td>' + (student.billing_start_month ? escapeHtml(formatReferenceMonth(student.billing_start_month)) : "—") + '</td>' +
      '<td><span class="status-pill ' + statusClass + '">' + statusLabel + '</span></td>' +
      '<td><button class="table-action" type="button" data-action="settings" data-student-id="' + escapeHtml(student.student_id) + '">' +
        (configuredStudent ? "EDITAR" : "CONFIGURAR") +
      '</button></td>' +
    '</tr>';
  }).join("");
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("open");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("open");
}

function openSettingsModal(studentId) {
  const student = billingStudents.find(function (item) { return String(item.student_id) === String(studentId); });
  if (!student) return;

  selectedStudentId = student.student_id;
  document.getElementById("settingsStudentName").textContent = student.name || student.email || "Aluno";
  document.getElementById("monthlyFee").value = student.monthly_fee != null ? Number(student.monthly_fee).toFixed(2) : "";
  document.getElementById("dueDay").value = student.due_day || 10;
  document.getElementById("billingStartMonth").value = student.billing_start_month
    ? String(student.billing_start_month).slice(0, 7)
    : document.getElementById("referenceMonth").value;
  document.getElementById("billingActive").checked = student.monthly_fee == null || student.billing_active === true;
  document.getElementById("billingNotes").value = student.billing_notes || "";
  setFormMessage("settingsMessage", "", "");
  openModal("settingsModal");
}

async function saveBillingSettings(event) {
  event.preventDefault();
  const button = document.getElementById("saveSettingsButton");
  const fee = Number(document.getElementById("monthlyFee").value);
  const dueDay = Number(document.getElementById("dueDay").value);
  const startMonth = document.getElementById("billingStartMonth").value;

  if (!fee || fee <= 0 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31 || !startMonth) {
    setFormMessage("settingsMessage", "Informe valor, vencimento e mês inicial válidos.", "error");
    return;
  }

  setButtonBusy(button, true, "SALVANDO...");
  setFormMessage("settingsMessage", "Salvando configuração...", "info");

  try {
    const response = await Auth.getClient().rpc("save_student_billing_settings", {
      target_student_id: selectedStudentId,
      target_monthly_fee: fee,
      target_due_day: dueDay,
      target_billing_start_month: startMonth + "-01",
      target_active: document.getElementById("billingActive").checked,
      target_notes: document.getElementById("billingNotes").value.trim()
    });
    if (response.error) throw response.error;

    await loadBillingStudents();
    await loadSelectedMonth({ generate: true });
    closeModal("settingsModal");
    setPageMessage("Configuração financeira atualizada.", "success");
  } catch (error) {
    setFormMessage("settingsMessage", "Não foi possível salvar: " + (error.message || "erro desconhecido"), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

function openPaymentModal(tuitionId) {
  const item = monthlyTuition.find(function (tuition) { return String(tuition.tuition_id) === String(tuitionId); });
  if (!item) return;

  selectedTuitionId = item.tuition_id;
  document.getElementById("paymentStudentName").textContent = item.student_name || "Aluno";
  document.getElementById("paymentReference").textContent = formatReferenceMonth(item.reference_month) + " · vencimento " + formatDate(item.due_date);
  document.getElementById("paymentDate").value = dateToInputValue(new Date());
  document.getElementById("amountPaid").value = Number(item.amount_due).toFixed(2);
  document.getElementById("paymentMethod").value = "pix";
  document.getElementById("paymentNotes").value = "";
  setFormMessage("paymentMessage", "", "");
  openModal("paymentModal");
}

async function registerPayment(event) {
  event.preventDefault();
  const button = document.getElementById("savePaymentButton");
  const amountPaid = Number(document.getElementById("amountPaid").value);

  if (!document.getElementById("paymentDate").value || !amountPaid || amountPaid <= 0) {
    setFormMessage("paymentMessage", "Informe a data e o valor pago.", "error");
    return;
  }

  setButtonBusy(button, true, "REGISTRANDO...");
  setFormMessage("paymentMessage", "Registrando pagamento...", "info");

  try {
    const response = await Auth.getClient().rpc("record_tuition_payment", {
      target_tuition_id: selectedTuitionId,
      target_payment_date: document.getElementById("paymentDate").value,
      target_amount_paid: amountPaid,
      target_payment_method: document.getElementById("paymentMethod").value,
      target_payment_notes: document.getElementById("paymentNotes").value.trim()
    });
    if (response.error) throw response.error;

    await loadSelectedMonth({ generate: false });
    closeModal("paymentModal");
    setPageMessage("Pagamento registrado com sucesso.", "success");
  } catch (error) {
    setFormMessage("paymentMessage", "Não foi possível registrar: " + (error.message || "erro desconhecido"), "error");
  } finally {
    setButtonBusy(button, false);
  }
}

async function exemptTuition(tuitionId) {
  const reason = window.prompt("Motivo da isenção (opcional). Clique em Cancelar para desistir:", "");
  if (reason === null) return;
  if (!window.confirm("Confirma a isenção desta mensalidade? O valor não será contabilizado como recebimento.")) return;

  try {
    setPageMessage("Registrando isenção...", "info");
    const response = await Auth.getClient().rpc("mark_tuition_exempt", {
      target_tuition_id: tuitionId,
      target_reason: reason.trim()
    });
    if (response.error) throw response.error;
    await loadSelectedMonth({ generate: false });
    setPageMessage("Mensalidade marcada como ISENTA. O valor foi excluído dos recebimentos do mês.", "success");
  } catch (error) {
    setPageMessage("Não foi possível aplicar a isenção: " + (error.message || "erro desconhecido"), "error");
  }
}

async function removeTuitionExemption(tuitionId) {
  const reason = window.prompt("Motivo da remoção da isenção (opcional). Clique em Cancelar para desistir:", "");
  if (reason === null) return;
  if (!window.confirm("Confirma a remoção da isenção? A mensalidade voltará a ficar em aberto.")) return;

  try {
    setPageMessage("Removendo isenção...", "info");
    const response = await Auth.getClient().rpc("reverse_tuition_exemption", {
      target_tuition_id: tuitionId,
      target_reason: reason.trim()
    });
    if (response.error) throw response.error;
    await loadSelectedMonth({ generate: false });
    setPageMessage("Isenção removida. A mensalidade voltou a ficar em aberto.", "success");
  } catch (error) {
    setPageMessage("Não foi possível remover a isenção: " + (error.message || "erro desconhecido"), "error");
  }
}

async function reversePayment(tuitionId) {
  const reason = window.prompt("Motivo do estorno (opcional). Clique em Cancelar para desistir:", "");
  if (reason === null) return;
  if (!window.confirm("Confirma o estorno deste pagamento? A mensalidade voltará a ficar em aberto.")) return;

  try {
    setPageMessage("Estornando pagamento...", "info");
    const response = await Auth.getClient().rpc("reverse_tuition_payment", {
      target_tuition_id: tuitionId,
      target_reason: reason.trim()
    });
    if (response.error) throw response.error;
    await loadSelectedMonth({ generate: false });
    setPageMessage("Pagamento estornado. O registro foi preservado no histórico de auditoria.", "success");
  } catch (error) {
    setPageMessage("Não foi possível estornar: " + (error.message || "erro desconhecido"), "error");
  }
}

async function openHistoryModal(studentId) {
  const student = billingStudents.find(function (item) { return String(item.student_id) === String(studentId); });
  const body = document.getElementById("historyTableBody");
  const empty = document.getElementById("historyEmpty");
  document.getElementById("historyStudentName").textContent = student ? (student.name || student.email || "Aluno") : "Aluno";
  body.innerHTML = "";
  empty.hidden = false;
  empty.textContent = "Carregando histórico...";
  openModal("historyModal");

  try {
    const response = await Auth.getClient().rpc("get_teacher_student_tuition_history", {
      target_student_id: studentId
    });
    if (response.error) throw response.error;
    const history = response.data || [];

    if (!history.length) {
      empty.textContent = "Nenhuma mensalidade registrada para este aluno.";
      return;
    }

    empty.hidden = true;
    body.innerHTML = history.map(function (item) {
      const status = getStatusMeta(item.payment_status);
      return '<tr>' +
        '<td>' + escapeHtml(formatReferenceMonth(item.reference_month)) + '</td>' +
        '<td>' + escapeHtml(formatDate(item.due_date)) + '</td>' +
        '<td>' + escapeHtml(formatCurrency(item.amount_due)) + '</td>' +
        '<td>' + escapeHtml(formatDate(item.payment_date)) + '</td>' +
        '<td>' + (item.amount_paid ? escapeHtml(formatCurrency(item.amount_paid)) : "—") + '</td>' +
        '<td><span class="status-pill ' + status.className + '">' + status.label + '</span></td>' +
      '</tr>';
    }).join("");
  } catch (error) {
    empty.textContent = "Não foi possível carregar o histórico: " + (error.message || "erro desconhecido");
  }
}

function exportCurrentView() {
  const rows = getFilteredTuition();
  if (!rows.length) return;
  if (!window.XLSX) {
    setPageMessage("O gerador de Excel não foi carregado. Atualize a página e tente novamente.", "error");
    return;
  }

  const data = rows.map(function (item) {
    return {
      "Aluno": item.student_name || "",
      "E-mail": item.student_email || "",
      "Mês de referência": formatReferenceMonth(item.reference_month),
      "Vencimento": formatDate(item.due_date),
      "Valor devido": Number(item.amount_due || 0),
      "Data do pagamento": formatDate(item.payment_date),
      "Valor pago": item.amount_paid == null ? "" : Number(item.amount_paid),
      "Forma de pagamento": paymentMethodLabels[item.payment_method] || "",
      "Status": getStatusMeta(item.payment_status).label,
      "Observações": item.payment_notes || ""
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  worksheet["!cols"] = [
    { wch: 28 }, { wch: 30 }, { wch: 20 }, { wch: 14 }, { wch: 15 },
    { wch: 20 }, { wch: 15 }, { wch: 22 }, { wch: 14 }, { wch: 36 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Mensalidades");
  XLSX.writeFile(workbook, "mensalidades_" + document.getElementById("referenceMonth").value + ".xlsx", { compression: true });
}

function handleTuitionTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "pay") openPaymentModal(button.dataset.tuitionId);
  if (button.dataset.action === "exempt") exemptTuition(button.dataset.tuitionId);
  if (button.dataset.action === "remove-exemption") removeTuitionExemption(button.dataset.tuitionId);
  if (button.dataset.action === "reverse") reversePayment(button.dataset.tuitionId);
  if (button.dataset.action === "history") openHistoryModal(button.dataset.studentId);
}

function handleBillingTableClick(event) {
  const button = event.target.closest('button[data-action="settings"]');
  if (button) openSettingsModal(button.dataset.studentId);
}

function attachEvents() {
  document.getElementById("referenceMonth").addEventListener("change", function () {
    loadSelectedMonth({ generate: true });
  });
  document.getElementById("studentSearch").addEventListener("input", renderDashboard);
  document.getElementById("statusFilter").addEventListener("change", renderDashboard);
  document.getElementById("refreshMonthButton").addEventListener("click", function () {
    (async function () {
      try {
        setPageMessage("Verificando confirmações do Mercado Pago...", "info");
        const reconciliation = await reconcileMercadoPagoPayments();
        await loadSelectedMonth({ generate: true });
        if (Number(reconciliation.approved || 0) > 0) {
          setPageMessage(
            Number(reconciliation.approved) + " pagamento(s) confirmado(s) pelo Mercado Pago.",
            "success"
          );
        }
      } catch (error) {
        console.warn("Não foi possível reconciliar pagamentos do Mercado Pago:", error);
        await loadSelectedMonth({ generate: true });
      }
    })();
  });
  document.getElementById("exportButton").addEventListener("click", exportCurrentView);
  document.getElementById("tuitionTableBody").addEventListener("click", handleTuitionTableClick);
  document.getElementById("billingStudentsBody").addEventListener("click", handleBillingTableClick);
  document.getElementById("settingsForm").addEventListener("submit", saveBillingSettings);
  document.getElementById("paymentForm").addEventListener("submit", registerPayment);

  document.querySelectorAll("[data-close-modal]").forEach(function (button) {
    button.addEventListener("click", function () { closeModal(button.dataset.closeModal); });
  });

  document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-backdrop.open").forEach(function (modal) {
      closeModal(modal.id);
    });
  });
}

async function initializePage() {
  const status = document.getElementById("adminStatus");
  document.getElementById("referenceMonth").value = currentMonthValue();
  attachEvents();

  const resourcesReady = await waitForAuthResources();
  if (!resourcesReady) {
    status.textContent = "Não foi possível carregar a autenticação. Atualize a página.";
    document.body.classList.remove("auth-checking");
    return;
  }

  currentAdminSession = await Auth.getSession();
  if (!currentAdminSession || !currentAdminSession.user) {
    redirectToLogin();
    return;
  }

  try {
    const isAdmin = await assertAdminAccess();
    if (!isAdmin) {
      status.textContent = "Acesso negado. Esta página é exclusiva do administrador.";
      document.getElementById("financialContent").hidden = true;
      document.body.classList.remove("auth-checking");
      return;
    }

    status.textContent = "Administrador autenticado: " + currentAdminSession.user.email + ".";
    document.body.classList.remove("auth-checking");
    let reconciliation = {};
    try {
      reconciliation = await reconcileMercadoPagoPayments();
    } catch (error) {
      console.warn("Não foi possível reconciliar pagamentos do Mercado Pago:", error);
    }
    await loadBillingStudents();
    await loadSelectedMonth({ generate: true });
    if (Number(reconciliation.approved || 0) > 0) {
      setPageMessage(
        Number(reconciliation.approved) + " pagamento(s) confirmado(s) pelo Mercado Pago.",
        "success"
      );
    }
  } catch (error) {
    status.textContent = "Não foi possível abrir o controle financeiro.";
    document.body.classList.remove("auth-checking");
    setPageMessage(
      (error.message || "Erro desconhecido") + ". Execute supabase_mensalidades.sql no Supabase.",
      "error"
    );
  }
}

initializePage();

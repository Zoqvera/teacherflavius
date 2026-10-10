(function () {
  "use strict";

  const WEEKDAYS = [
    ["seg", "Segunda-feira", 1], ["ter", "Terça-feira", 2],
    ["qua", "Quarta-feira", 3], ["qui", "Quinta-feira", 4], ["sex", "Sexta-feira", 5]
  ];
  const HOURS = ["09:00", "10:00", "12:00", "13:00", "15:00", "17:00", "18:00", "20:00", "21:00"];
  const STATUS_LABELS = {
    awaiting_payment: "Aguardando pagamento", reserved: "Reservado",
    enrolled: "Matriculado", cancelled: "Cancelado", expired: "Expirado"
  };
  const PAYMENT_LABELS = {
    pix: "Pix", cash: "Dinheiro", card: "Cartão",
    bank_transfer: "Transferência", other: "Outra"
  };
  const DISPOSITION_LABELS = {
    undecided: "Destino a decidir", independent: "Taxa independente",
    first_tuition: "Crédito para primeira mensalidade"
  };
  const RPC = Object.freeze({
    list: "get_teacher_promotion_reservations",
    save: "save_teacher_promotion_reservation",
    status: "set_teacher_promotion_reservation_status",
    credit: "apply_teacher_promotion_credit"
  });
  const state = { reservations: [], classes: [], editingId: null, busy: false };
  const byId = id => document.getElementById(id);
  const value = id => byId(id).value.trim();

  function localToday() {
    return new Intl.DateTimeFormat("sv-SE", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo"
    }).format(new Date());
  }

  function formatDate(date) {
    if (!date) return "—";
    const parts = String(date).slice(0, 10).split("-");
    return parts.length === 3 ? [parts[2], parts[1], parts[0]].join("/") : "—";
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
      .format(Number(amount || 0));
  }

  function normalizePhone(valueToNormalize) {
    let digits = String(valueToNormalize || "").replace(/\D/g, "");
    if ([12, 13].includes(digits.length) && digits.startsWith("55")) digits = digits.slice(2);
    return digits.length === 10 || digits.length === 11 ? digits : null;
  }

  function labelSlot(slot) {
    const [day, hour] = String(slot).split("|");
    const weekday = WEEKDAYS.find(item => item[0] === day);
    return weekday ? weekday[1].split("-")[0] + " " + hour : slot;
  }

  function createElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content != null) element.textContent = String(content);
    return element;
  }

  function showMessage(message, type) {
    const box = byId("reservationMessage");
    box.textContent = message || "";
    box.className = "reservation-message" + (type ? " " + type : "");
    box.hidden = !message;
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    byId("reserveSave").disabled = isBusy;
    byId("refreshReservations").disabled = isBusy;
    byId("reserveSave").textContent = isBusy ? "SALVANDO..." : (state.editingId ? "SALVAR ALTERAÇÕES" : "SALVAR RESERVA");
  }

  function createAvailabilityFields() {
    const container = byId("reserveAvailability");
    for (const [day, label] of WEEKDAYS) {
      const column = createElement("div", "reservation-day");
      column.appendChild(createElement("h3", "", label));
      for (const hour of HOURS) {
        const choice = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "reserveSlot";
        checkbox.value = day + "|" + hour;
        choice.appendChild(checkbox);
        choice.appendChild(createElement("span", "", hour));
        column.appendChild(choice);
      }
      container.appendChild(column);
    }
  }

  function selectedAvailability() {
    return Array.from(document.querySelectorAll('input[name="reserveSlot"]:checked'))
      .map(element => element.value);
  }

  function setAvailability(slots) {
    const saved = new Set(Array.isArray(slots) ? slots : []);
    document.querySelectorAll('input[name="reserveSlot"]').forEach(input => {
      input.checked = saved.has(input.value);
    });
  }

  function resetForm() {
    state.editingId = null;
    byId("reservationForm").reset();
    byId("reserveDate").value = localToday();
    byId("reservePaid").value = "0";
    byId("reservePaymentDate").value = "";
    setAvailability([]);
    byId("reservationFormTitle").textContent = "Nova reserva promocional";
    byId("reserveCancelEdit").hidden = true;
    byId("reserveSave").textContent = "SALVAR RESERVA";
  }

  function syncPaymentFields() {
    const hasPayment = Number(value("reservePaid")) > 0;
    byId("reservePaymentDate").required = hasPayment;
    byId("reserveMethod").required = hasPayment;
    if (hasPayment && !byId("reservePaymentDate").value) {
      byId("reservePaymentDate").value = localToday();
    }
    if (!hasPayment) byId("reservePaymentDate").value = "";
  }

  function collectForm() {
    const paid = Number(value("reservePaid"));
    const price = Number(value("reservePromotionalPrice"));
    if (!normalizePhone(value("reservePhone"))) throw new Error("Informe um WhatsApp com DDD válido.");
    if (!Number.isFinite(paid) || paid < 0 || !Number.isFinite(price) || price <= 0) {
      throw new Error("Informe valores monetários válidos.");
    }
    const expiresOn = value("reserveExpiry");
    if (expiresOn && expiresOn < value("reserveDate")) {
      throw new Error("A validade não pode ser anterior à data da reserva.");
    }
    if (paid > 0 && (!value("reserveMethod") || !value("reservePaymentDate"))) {
      throw new Error("Informe a forma e a data do pagamento.");
    }
    return {
      full_name: value("reserveName"), whatsapp: value("reservePhone"),
      english_level: value("reserveLevel"), availability: selectedAvailability(),
      availability_notes: value("reserveAvailabilityNotes"),
      reserved_on: value("reserveDate"), promotional_tuition: price,
      promotion_expires_on: expiresOn || null, promotion_terms: value("reserveTerms"),
      amount_paid: paid, payment_date: paid > 0 ? value("reservePaymentDate") : null,
      payment_method: paid > 0 ? value("reserveMethod") : null,
      payment_provider: value("reserveProvider"), payment_notes: value("reservePaymentNotes"),
      payment_disposition: value("reserveDisposition"), notes: value("reserveNotes")
    };
  }

  function editReservation(reservation) {
    state.editingId = reservation.id;
    const fields = {
      reserveName: reservation.full_name, reservePhone: reservation.whatsapp,
      reserveLevel: reservation.english_level, reserveAvailabilityNotes: reservation.availability_notes,
      reserveDate: reservation.reserved_on, reservePromotionalPrice: reservation.promotional_tuition,
      reserveExpiry: reservation.promotion_expires_on, reserveTerms: reservation.promotion_terms,
      reservePaid: reservation.amount_paid, reservePaymentDate: reservation.payment_date,
      reserveMethod: reservation.payment_method, reserveProvider: reservation.payment_provider,
      reservePaymentNotes: reservation.payment_notes, reserveDisposition: reservation.payment_disposition,
      reserveNotes: reservation.notes
    };
    for (const [id, fieldValue] of Object.entries(fields)) byId(id).value = fieldValue == null ? "" : fieldValue;
    setAvailability(reservation.availability);
    syncPaymentFields();
    byId("reservationFormTitle").textContent = "Editar reserva de " + reservation.full_name;
    byId("reserveSave").textContent = "SALVAR ALTERAÇÕES";
    byId("reserveCancelEdit").hidden = false;
    byId("reservationForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function callRpc(name, args) {
    const response = await window.Auth.getClient().rpc(name, args || {});
    if (response.error) throw response.error;
    return response.data;
  }

  async function saveReservation(event) {
    event.preventDefault();
    if (state.busy) return;
    setBusy(true);
    try {
      const input = collectForm();
      await callRpc(RPC.save, { target_id: state.editingId, input });
      resetForm();
      await reload();
      showMessage("Reserva promocional salva com sucesso.", "success");
    } catch (error) {
      showMessage("Não foi possível salvar: " + (error.message || "erro desconhecido"), "error");
    } finally {
      setBusy(false);
    }
  }

  function updateSummary() {
    const items = state.reservations;
    const active = items.filter(item => item.status === "reserved").length;
    const enrolled = items.filter(item => item.status === "enrolled").length;
    const receipts = items.filter(item => !item.credit_applied_tuition_id)
      .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
    const denominator = enrolled + active + items.filter(item => item.status === "expired" || item.status === "cancelled").length;
    const data = [
      ["Reservas registradas", String(items.length)],
      ["Reservas confirmadas", String(active)],
      ["Convertidas em matrícula", String(enrolled)],
      ["Recebimentos não transferidos", formatCurrency(receipts)],
      ["Aguardando pagamento", String(items.filter(item => item.status === "awaiting_payment").length)],
      ["Conversão de reservas", denominator ? Math.round(enrolled * 100 / denominator) + "%" : "—"]
    ];
    const parent = byId("reservationSummary");
    parent.replaceChildren();
    for (const [label, content] of data) {
      const card = createElement("div", "reservation-stat");
      card.appendChild(createElement("span", "", label));
      card.appendChild(createElement("strong", "", content));
      parent.appendChild(card);
    }
  }

  function makeButton(label, handler) {
    const button = createElement("button", "", label);
    button.type = "button";
    button.addEventListener("click", () => runAction(handler));
    return button;
  }

  async function runAction(handler) {
    if (state.busy) return;
    setBusy(true);
    try {
      const message = await handler();
      if (!message) return;
      await reload();
      showMessage(message, "success");
    } catch (error) {
      showMessage(error.message || "Não foi possível realizar a operação.", "error");
    } finally {
      setBusy(false);
    }
  }

  function matchingStudent(reservation) {
    const normalized = normalizePhone(reservation.whatsapp);
    if (!normalized) return null;
    const matches = state.students.filter(student => student.enrolled === true &&
      normalizePhone(student.whatsapp) === normalized);
    return matches.length === 1 ? matches[0] : null;
  }

  async function setReservationStatus(reservation, newStatus) {
    const actionLabel = newStatus === "enrolled" ? "confirmar a matrícula" :
      newStatus === "cancelled" ? "cancelar a reserva" : "alterar a situação";
    if (!window.confirm("Deseja " + actionLabel + " de " + reservation.full_name + "?")) return null;
    const matchedStudent = newStatus === "enrolled" ? matchingStudent(reservation) : null;
    await callRpc(RPC.status, {
      target_id: reservation.id, target_status: newStatus,
      target_student_id: matchedStudent ? matchedStudent.user_id || matchedStudent.id : null
    });
    if (newStatus === "enrolled" && !matchedStudent) {
      return "Matrícula marcada manualmente. Nenhum perfil foi vinculado: confira o WhatsApp do aluno.";
    }
    return "Situação atualizada.";
  }

  async function applyCredit(reservation) {
    if (!window.confirm("Aplicar o valor já recebido à primeira mensalidade? A operação exige valor integral e mensalidade sem pagamento.")) return null;
    await callRpc(RPC.credit, { target_id: reservation.id });
    return "Pagamento reclassificado e vinculado à primeira mensalidade, sem novo recebimento.";
  }

  function appendDetail(parent, title, detail) {
    parent.appendChild(createElement("p", "", title + ": " + (detail || "—")));
  }

  function renderReservation(reservation) {
    const card = createElement("article", "reservation-item");
    const header = createElement("div", "reservation-item-header");
    const heading = createElement("h3", "", reservation.full_name);
    header.appendChild(heading);
    header.appendChild(createElement("span", "reservation-status " + reservation.status,
      STATUS_LABELS[reservation.status] || reservation.status));
    card.appendChild(header);
    appendDetail(card, "WhatsApp", reservation.whatsapp);
    appendDetail(card, "Nível", reservation.english_level);
    appendDetail(card, "Disponibilidade", (reservation.availability || []).map(labelSlot).join(", ") ||
      "Não informada");
    if (reservation.availability_notes) appendDetail(card, "Disponibilidade (obs.)", reservation.availability_notes);
    appendDetail(card, "Reserva", formatDate(reservation.reserved_on));
    appendDetail(card, "Mensalidade prometida", formatCurrency(reservation.promotional_tuition));
    appendDetail(card, "Condições", reservation.promotion_terms);
    if (reservation.promotion_expires_on) appendDetail(card, "Validade", formatDate(reservation.promotion_expires_on));
    appendDetail(card, "Valor pago", formatCurrency(reservation.amount_paid));
    if (Number(reservation.amount_paid) > 0) {
      appendDetail(card, "Pagamento", [formatDate(reservation.payment_date),
        PAYMENT_LABELS[reservation.payment_method] || reservation.payment_method,
        reservation.payment_provider, reservation.payment_notes].filter(Boolean).join(" · "));
    }
    appendDetail(card, "Destino", DISPOSITION_LABELS[reservation.payment_disposition]);
    if (reservation.linked_trial_id) appendDetail(card, "Aula experimental", "Registro associado");
    if (reservation.matched_student_id) appendDetail(card, "Matrícula", "Perfil vinculado");
    if (reservation.credit_applied_tuition_id) appendDetail(card, "Crédito", "Aplicado à mensalidade " + reservation.credit_applied_tuition_id.slice(0, 8));
    if (reservation.notes) appendDetail(card, "Observações", reservation.notes);

    const actions = createElement("div", "reservation-item-actions");
    actions.appendChild(makeButton("EDITAR", async () => { editReservation(reservation); return null; }));
    const wa = createElement("a", "", "WHATSAPP");
    wa.href = "https://wa.me/55" + normalizePhone(reservation.whatsapp);
    wa.target = "_blank"; wa.rel = "noopener noreferrer";
    actions.appendChild(wa);
    if (reservation.status !== "enrolled") {
      actions.appendChild(makeButton("MARCAR MATRICULADO", () => setReservationStatus(reservation, "enrolled")));
    }
    if (reservation.status === "enrolled" && !reservation.credit_applied_tuition_id) {
      actions.appendChild(makeButton("DESFAZER MARCAÇÃO", () => setReservationStatus(reservation,
        Number(reservation.amount_paid) > 0 ? "reserved" : "awaiting_payment")));
    }
    if (reservation.status === "reserved" || reservation.status === "awaiting_payment") {
      actions.appendChild(makeButton("CANCELAR RESERVA", () => setReservationStatus(reservation, "cancelled")));
    }
    if (reservation.status === "cancelled" || reservation.status === "expired") {
      actions.appendChild(makeButton("REATIVAR", () => setReservationStatus(reservation,
        Number(reservation.amount_paid) > 0 ? "reserved" : "awaiting_payment")));
    }
    if (reservation.status === "enrolled" && reservation.matched_student_id &&
      reservation.payment_disposition === "first_tuition" && Number(reservation.amount_paid) > 0 &&
      !reservation.credit_applied_tuition_id) {
      actions.appendChild(makeButton("APLICAR CRÉDITO À MENSALIDADE", () => applyCredit(reservation)));
    }
    card.appendChild(actions);
    return card;
  }

  function renderReservations() {
    const nameSearch = value("reservationSearch").toLocaleLowerCase("pt-BR");
    const statusFilter = value("reservationStatusFilter");
    const levelFilter = value("reservationLevelFilter");
    const filtered = state.reservations.filter(item =>
      (!statusFilter || item.status === statusFilter) &&
      (!levelFilter || item.english_level === levelFilter) &&
      (!nameSearch || item.full_name.toLocaleLowerCase("pt-BR").includes(nameSearch) ||
        (nameSearch.replace(/\D/g, "").length >= 4 &&
          String(item.whatsapp).replace(/\D/g, "").includes(nameSearch.replace(/\D/g, ""))))
    );
    const list = byId("reservationsList");
    list.replaceChildren();
    if (!filtered.length) {
      list.appendChild(createElement("p", "reservation-empty", "Nenhuma reserva corresponde aos filtros."));
      return;
    }
    filtered.forEach(item => list.appendChild(renderReservation(item)));
  }

  function renderMatching() {
    const counts = new Map();
    state.reservations.filter(item => item.status === "reserved").forEach(item => {
      new Set(item.availability || []).forEach(slot => counts.set(slot, (counts.get(slot) || 0) + 1));
    });
    const ranked = Array.from(counts.entries()).filter(([, count]) => count >= 2)
      .sort((first, second) => second[1] - first[1]).slice(0, 8);
    const box = byId("reservationsMatching");
    box.replaceChildren();
    if (!ranked.length) {
      box.appendChild(createElement("p", "reservation-empty", "Ainda não há horários compartilhados por duas ou mais reservas confirmadas."));
      return;
    }
    for (const [slot, count] of ranked) {
      const compatible = state.classes.filter(item => {
        if (item.class_type !== "quintet" || !item.class_weekday || !item.class_start_time) return false;
        const day = WEEKDAYS.find(weekday => weekday[2] === Number(item.class_weekday));
        const classSlot = day ? day[0] + "|" + String(item.class_start_time).slice(0, 5) : "";
        const capacity = Number(item.capacity_override || 8);
        return classSlot === slot && Number(item.student_count || 0) < capacity;
      });
      const classText = compatible.length ? " · Turmas com possível vaga: " +
        compatible.map(item => item.class_name || "Turma " + item.class_number).join(", ") : "";
      box.appendChild(createElement("span", "reservation-chip", labelSlot(slot) +
        " · " + count + " interessados" + classText));
    }
  }

  async function loadAuxiliaryData() {
    const client = window.Auth.getClient();
    const [students, classes, schedules] = await Promise.all([
      client.rpc("get_teacher_students"),
      client.rpc("get_teacher_classes_with_type"),
      client.from("teacher_classes").select("class_number,class_weekday,class_start_time,capacity_override").eq("is_active", true)
    ]);
    state.students = students.error ? [] : students.data || [];
    if (classes.error || schedules.error) { state.classes = []; return; }
    const scheduleMap = new Map((schedules.data || []).map(item => [Number(item.class_number), item]));
    state.classes = (classes.data || []).map(item =>
      Object.assign({}, item, scheduleMap.get(Number(item.class_number)) || {}));
  }

  async function reload() {
    const reservations = await callRpc(RPC.list);
    state.reservations = Array.isArray(reservations) ? reservations : [];
    updateSummary();
    renderReservations();
    renderMatching();
  }

  async function waitForAuth() {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (window.Auth && window.Auth.isConfigured && window.Auth.isConfigured()) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  async function initialize() {
    createAvailabilityFields();
    resetForm();
    byId("reservationForm").addEventListener("submit", saveReservation);
    byId("reserveCancelEdit").addEventListener("click", resetForm);
    byId("reservePaid").addEventListener("input", syncPaymentFields);
    ["reservationSearch", "reservationStatusFilter", "reservationLevelFilter"].forEach(id =>
      byId(id).addEventListener(id === "reservationSearch" ? "input" : "change", renderReservations));
    byId("refreshReservations").addEventListener("click", () => runAction(async () => {
      await loadAuxiliaryData();
      return "Dados atualizados.";
    }));

    try {
      if (!await waitForAuth()) throw new Error("Não foi possível carregar a autenticação.");
      const session = await window.Auth.getSession();
      if (!session || !session.user) {
        window.location.assign("/login/?next=" + encodeURIComponent("/reservas-de-vagas/"));
        return;
      }
      // The reservation RPC also enforces a live teacher MFA session on the server.
      await reload();
      await loadAuxiliaryData();
      renderMatching();
      document.body.classList.remove("auth-checking");
      showMessage("");
    } catch (error) {
      document.body.classList.remove("auth-checking");
      byId("reservationForm").hidden = true;
      showMessage("Acesso indisponível: " + (error.message || "falha de autenticação."), "error");
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
      initialize();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizePhone, labelSlot };
  }
})();

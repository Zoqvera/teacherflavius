(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.TrialLessonScheduler = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const TIME_ZONE = "America/Sao_Paulo";
  const VALID_LEVELS = Object.freeze(["A1", "A2", "B1", "B2", "C1", "C2", "Não definido"]);
  const STATUS_LABELS = Object.freeze({
    scheduled: "AGENDADA",
    completed: "CONCLUÍDA",
    cancelled: "CANCELADA",
    no_show: "NÃO COMPARECEU"
  });

  function toText(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return toText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function whatsappDigits(value) {
    return toText(value).replace(/\D/g, "");
  }

  function whatsappUrl(value) {
    const digits = whatsappDigits(value);
    return digits.length >= 8 && digits.length <= 15 ? "https://wa.me/" + digits : "";
  }

  function formatLocalDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data inválida";
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: TIME_ZONE
    }).format(date);
  }

  function saoPauloNowParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date || new Date());
    const map = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") map[part.type] = part.value;
    });
    const year = Number(map.year);
    const month = Number(map.month);
    const day = Number(map.day);
    const weekdayDate = new Date(Date.UTC(year, month - 1, day));
    const jsWeekday = weekdayDate.getUTCDay();
    return Object.freeze({
      year: year,
      month: month,
      day: day,
      isoDate: map.year + "-" + map.month + "-" + map.day,
      isoWeekday: jsWeekday === 0 ? 7 : jsWeekday,
      totalMinutes: Number(map.hour) * 60 + Number(map.minute)
    });
  }

  function parseTimeMinutes(value) {
    const match = /^(\d{2}):(\d{2})/.exec(toText(value));
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function addDaysToIsoDate(parts, days) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return [
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  function nextClassDate(classWeekday, startTime, nowParts) {
    const parts = nowParts || saoPauloNowParts(new Date());
    const weekday = Number(classWeekday);
    const classMinutes = parseTimeMinutes(startTime);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || classMinutes == null) return "";
    let daysAhead = (weekday - parts.isoWeekday + 7) % 7;
    if (daysAhead === 0 && classMinutes <= parts.totalMinutes) daysAhead = 7;
    return addDaysToIsoDate(parts, daysAhead);
  }

  function isoWeekday(dateValue) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toText(dateValue));
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(date.getTime())) return null;
    const jsWeekday = date.getUTCDay();
    return jsWeekday === 0 ? 7 : jsWeekday;
  }

  function isClassDateValid(dateValue, classWeekday) {
    return isoWeekday(dateValue) === Number(classWeekday);
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "SEM STATUS";
  }

  function modeLabel(appointment) {
    if (appointment.lesson_mode === "class") {
      return appointment.class_name || (appointment.class_number ? "Turma " + appointment.class_number : "Turma");
    }
    return "Aula individual";
  }

  function isUpcoming(appointment, now) {
    return appointment.status === "scheduled" &&
      new Date(appointment.starts_at).getTime() > (now || Date.now());
  }

  function normalizeError(error) {
    const message = toText(error && error.message).trim();
    return message || "Não foi possível concluir a operação.";
  }

  function buildCard(appointment) {
    const contactUrl = whatsappUrl(appointment.whatsapp_digits || appointment.whatsapp);
    const scheduled = appointment.status === "scheduled";
    const actions = [
      contactUrl
        ? '<a class="trial-whatsapp-link" href="' + escapeHtml(contactUrl) + '" target="_blank" rel="noopener noreferrer">ABRIR WHATSAPP</a>'
        : ""
    ];

    if (scheduled) {
      actions.push(
        '<button class="trial-action-button success" type="button" data-trial-id="' + escapeHtml(appointment.id) + '" data-trial-status="completed">CONCLUIR</button>',
        '<button class="trial-action-button warning" type="button" data-trial-id="' + escapeHtml(appointment.id) + '" data-trial-status="no_show">NÃO COMPARECEU</button>',
        '<button class="trial-action-button danger" type="button" data-trial-id="' + escapeHtml(appointment.id) + '" data-trial-status="cancelled">CANCELAR</button>'
      );
    }

    return '<article class="trial-card">' +
      '<div class="trial-card-header">' +
        '<div><h3>' + escapeHtml(appointment.visitor_name) + '</h3>' +
        '<p class="trial-card-date">' + escapeHtml(formatLocalDateTime(appointment.starts_at)) + '</p></div>' +
        '<span class="trial-pill ' + escapeHtml(appointment.status) + '">' + escapeHtml(statusLabel(appointment.status)) + '</span>' +
      '</div>' +
      '<div class="trial-card-meta">' +
        '<span class="trial-pill">Nível ' + escapeHtml(appointment.english_level) + '</span>' +
        '<span class="trial-pill">' + escapeHtml(modeLabel(appointment)) + '</span>' +
      '</div>' +
      '<p class="trial-card-contact"><strong>WhatsApp:</strong> ' + escapeHtml(appointment.whatsapp) + '</p>' +
      '<div class="trial-card-actions">' + actions.join("") + '</div>' +
    '</article>';
  }

  function sortUpcoming(a, b) {
    return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
  }

  function sortRecent(a, b) {
    return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
  }

  function renderAppointments(documentRef, appointments) {
    const now = Date.now();
    const upcoming = appointments.filter(function (item) { return isUpcoming(item, now); }).sort(sortUpcoming);
    const history = appointments.filter(function (item) { return !isUpcoming(item, now); }).sort(sortRecent);

    const upcomingList = documentRef.getElementById("trialUpcomingList");
    const historyList = documentRef.getElementById("trialHistoryList");
    upcomingList.innerHTML = upcoming.length
      ? upcoming.map(buildCard).join("")
      : '<p class="trial-empty">Nenhuma aula experimental futura agendada.</p>';
    historyList.innerHTML = history.length
      ? history.map(buildCard).join("")
      : '<p class="trial-empty">Nenhum agendamento anterior.</p>';

    const today = saoPauloNowParts(new Date()).isoDate;
    const scheduledToday = upcoming.filter(function (item) {
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(item.starts_at));
      return localDate === today;
    }).length;
    const completed = appointments.filter(function (item) { return item.status === "completed"; }).length;
    const summary = documentRef.getElementById("trialSummary");
    summary.innerHTML =
      '<article class="trial-summary-card"><span>Próximas</span><strong>' + upcoming.length + '</strong></article>' +
      '<article class="trial-summary-card"><span>Hoje</span><strong>' + scheduledToday + '</strong></article>' +
      '<article class="trial-summary-card"><span>Concluídas</span><strong>' + completed + '</strong></article>';
  }

  function renderClassOptions(documentRef, classes) {
    const select = documentRef.getElementById("trialClassNumber");
    select.innerHTML = '<option value="">Selecione uma turma</option>' + classes.map(function (item) {
      const startTime = toText(item.class_start_time).slice(0, 5);
      return '<option value="' + escapeHtml(item.class_number) + '">' +
        escapeHtml(item.class_name) + " · " + escapeHtml(startTime) +
      "</option>";
    }).join("");
    select.disabled = classes.length === 0;
  }

  function selectedClass(state, documentRef) {
    const value = Number(documentRef.getElementById("trialClassNumber").value);
    return state.classes.find(function (item) { return Number(item.class_number) === value; }) || null;
  }

  function applyClassSchedule(state, documentRef) {
    const chosenClass = selectedClass(state, documentRef);
    const dateInput = documentRef.getElementById("trialDate");
    const timeInput = documentRef.getElementById("trialTime");
    const classHint = documentRef.getElementById("trialClassHint");
    if (!chosenClass) {
      timeInput.value = "";
      classHint.textContent = "Selecione uma turma para preencher automaticamente o dia e o horário.";
      return;
    }

    const startTime = toText(chosenClass.class_start_time).slice(0, 5);
    timeInput.value = startTime;
    dateInput.value = nextClassDate(chosenClass.class_weekday, startTime);
    classHint.textContent = "Próxima ocorrência sugerida para " + chosenClass.class_name + ".";
  }

  function applyMode(state, documentRef) {
    const mode = documentRef.getElementById("trialLessonMode").value;
    const classField = documentRef.getElementById("trialClassField");
    const classSelect = documentRef.getElementById("trialClassNumber");
    const timeInput = documentRef.getElementById("trialTime");
    const timeHint = documentRef.getElementById("trialTimeHint");

    if (mode === "class") {
      classField.hidden = false;
      classSelect.required = true;
      timeInput.readOnly = true;
      timeHint.textContent = "O horário é definido automaticamente pela turma selecionada.";
      applyClassSchedule(state, documentRef);
      return;
    }

    classField.hidden = true;
    classSelect.required = false;
    classSelect.value = "";
    timeInput.readOnly = false;
    if (!timeInput.value) timeInput.value = "14:00";
    timeHint.textContent = "Escolha livremente o horário da aula individual.";
  }

  function validateForm(state, documentRef) {
    const name = documentRef.getElementById("trialVisitorName").value.trim();
    const level = documentRef.getElementById("trialEnglishLevel").value;
    const whatsapp = documentRef.getElementById("trialWhatsapp").value.trim();
    const mode = documentRef.getElementById("trialLessonMode").value;
    const date = documentRef.getElementById("trialDate").value;
    const time = documentRef.getElementById("trialTime").value;
    const chosenClass = selectedClass(state, documentRef);

    if (name.length < 2) return "Informe o nome da pessoa.";
    if (!VALID_LEVELS.includes(level)) return "Selecione o nível de inglês.";
    if (whatsappDigits(whatsapp).length < 8 || whatsappDigits(whatsapp).length > 15) return "Informe um WhatsApp válido.";
    if (!date) return "Informe a data da aula experimental.";
    if (mode === "class" && !chosenClass) return "Selecione a turma da aula experimental.";
    if (mode === "class" && !isClassDateValid(date, chosenClass.class_weekday)) {
      return "A data escolhida não corresponde ao dia semanal da turma.";
    }
    if (mode === "individual" && parseTimeMinutes(time) == null) return "Informe o horário da aula individual.";
    return "";
  }

  function createPayload(state, documentRef) {
    const mode = documentRef.getElementById("trialLessonMode").value;
    const chosenClass = selectedClass(state, documentRef);
    return {
      target_name: documentRef.getElementById("trialVisitorName").value.trim(),
      target_english_level: documentRef.getElementById("trialEnglishLevel").value,
      target_whatsapp: documentRef.getElementById("trialWhatsapp").value.trim(),
      target_mode: mode,
      target_date: documentRef.getElementById("trialDate").value,
      target_time: documentRef.getElementById("trialTime").value || null,
      target_class_number: mode === "class" && chosenClass ? Number(chosenClass.class_number) : null
    };
  }

  function setMessage(documentRef, message, type) {
    const element = documentRef.getElementById("trialMessage");
    element.textContent = message || "";
    element.className = "trial-message" + (type ? " " + type : "");
    element.hidden = !message;
  }

  function setBusy(button, busy, busyLabel, idleLabel) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : idleLabel;
  }

  async function loadData(runtime) {
    const results = await Promise.all([
      runtime.client.rpc("get_teacher_trial_lesson_classes"),
      runtime.client.rpc("get_teacher_trial_lessons")
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    runtime.state.classes = Array.isArray(results[0].data) ? results[0].data : [];
    runtime.state.appointments = Array.isArray(results[1].data) ? results[1].data : [];
    renderClassOptions(runtime.documentRef, runtime.state.classes);
    applyMode(runtime.state, runtime.documentRef);
    renderAppointments(runtime.documentRef, runtime.state.appointments);
  }

  async function refresh(runtime) {
    const button = runtime.documentRef.getElementById("trialRefreshButton");
    setBusy(button, true, "ATUALIZANDO...", "ATUALIZAR");
    try {
      await loadData(runtime);
      setMessage(runtime.documentRef, "", "");
    } catch (error) {
      setMessage(runtime.documentRef, "Não foi possível carregar a agenda: " + normalizeError(error), "error");
      throw error;
    } finally {
      setBusy(button, false, "ATUALIZANDO...", "ATUALIZAR");
    }
  }

  async function submitAppointment(runtime) {
    const documentRef = runtime.documentRef;
    const validationError = validateForm(runtime.state, documentRef);
    if (validationError) {
      setMessage(documentRef, validationError, "error");
      return;
    }

    const button = documentRef.getElementById("trialSubmitButton");
    setBusy(button, true, "AGENDANDO...", "AGENDAR AULA EXPERIMENTAL");
    try {
      const response = await runtime.client.rpc("create_teacher_trial_lesson", createPayload(runtime.state, documentRef));
      if (response.error) throw response.error;
      documentRef.getElementById("trialVisitorName").value = "";
      documentRef.getElementById("trialWhatsapp").value = "";
      setMessage(documentRef, "Aula experimental agendada.", "success");
      await loadData(runtime);
    } catch (error) {
      setMessage(documentRef, normalizeError(error), "error");
    } finally {
      setBusy(button, false, "AGENDANDO...", "AGENDAR AULA EXPERIMENTAL");
    }
  }

  async function updateStatus(runtime, appointmentId, status) {
    const labels = {
      completed: "Marcar esta aula experimental como concluída?",
      no_show: "Registrar que a pessoa não compareceu?",
      cancelled: "Cancelar esta aula experimental?"
    };
    if (runtime.windowRef.confirm && !runtime.windowRef.confirm(labels[status] || "Atualizar este agendamento?")) return;

    const response = await runtime.client.rpc("update_teacher_trial_lesson_status", {
      target_appointment_id: appointmentId,
      target_status: status
    });
    if (response.error) throw response.error;
    setMessage(runtime.documentRef, "Status atualizado.", "success");
    await loadData(runtime);
  }

  function bindEvents(runtime) {
    const documentRef = runtime.documentRef;
    documentRef.getElementById("trialLessonMode").addEventListener("change", function () {
      applyMode(runtime.state, documentRef);
      setMessage(documentRef, "", "");
    });
    documentRef.getElementById("trialClassNumber").addEventListener("change", function () {
      applyClassSchedule(runtime.state, documentRef);
      setMessage(documentRef, "", "");
    });
    documentRef.getElementById("trialLessonForm").addEventListener("submit", function (event) {
      event.preventDefault();
      submitAppointment(runtime).catch(function () {});
    });
    documentRef.getElementById("trialRefreshButton").addEventListener("click", function () {
      refresh(runtime).catch(function () {});
    });

    function onStatusClick(event) {
      const button = event.target.closest("[data-trial-id][data-trial-status]");
      if (!button) return;
      button.disabled = true;
      updateStatus(runtime, button.dataset.trialId, button.dataset.trialStatus)
        .catch(function (error) {
          setMessage(documentRef, normalizeError(error), "error");
        })
        .finally(function () {
          button.disabled = false;
        });
    }

    documentRef.getElementById("trialUpcomingList").addEventListener("click", onStatusClick);
    documentRef.getElementById("trialHistoryList").addEventListener("click", onStatusClick);
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (
        windowRef.Auth && typeof windowRef.Auth.getClient === "function" &&
        windowRef.ProfessorMfaGate && typeof windowRef.ProfessorMfaGate.requireAal2 === "function"
      ) return true;
      await wait(150, windowRef);
    }
    return false;
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    if (!(await waitForDependencies(windowRef))) {
      setMessage(documentRef, "Não foi possível carregar a autenticação administrativa.", "error");
      documentRef.body.classList.remove("auth-checking");
      return false;
    }

    const client = windowRef.Auth.getClient();
    const teacherResponse = await client.rpc("is_teacher_admin");
    if (teacherResponse.error || teacherResponse.data !== true) {
      windowRef.location.href = "/login/?next=" + encodeURIComponent("/aulas-experimentais/");
      return false;
    }

    await windowRef.ProfessorMfaGate.requireAal2({ client: client });
    const state = { classes: [], appointments: [] };
    const runtime = { windowRef: windowRef, documentRef: documentRef, client: client, state: state };
    const today = saoPauloNowParts(new Date()).isoDate;
    documentRef.getElementById("trialDate").min = today;
    documentRef.getElementById("trialDate").value = today;
    bindEvents(runtime);
    documentRef.body.classList.remove("auth-checking");
    await refresh(runtime);
    return true;
  }

  return Object.freeze({
    whatsappDigits: whatsappDigits,
    whatsappUrl: whatsappUrl,
    saoPauloNowParts: saoPauloNowParts,
    nextClassDate: nextClassDate,
    isClassDateValid: isClassDateValid,
    statusLabel: statusLabel,
    isUpcoming: isUpcoming,
    validateForm: validateForm,
    initialize: initialize
  });
});

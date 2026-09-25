(function (root, factory) {
  "use strict";

  const whatsappApi = typeof module === "object" && module.exports
    ? require("./whatsapp_contact.js")
    : root && root.StudentsOfDayWhatsApp;
  const api = factory(whatsappApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root) return;

  root.StudentsOfDay = api;
  if (root.document) {
    const start = function () {
      api.initialize({ windowRef: root, documentRef: root.document }).catch(function () {});
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
})(typeof window !== "undefined" ? window : null, function (whatsappApi) {
  "use strict";

  if (!whatsappApi) throw new Error("Dependência de WhatsApp não carregada.");

  const TIME_ZONE = "America/Sao_Paulo";
  const PAGE_PATH = "/alunos-do-dia/";
  const DEFAULT_MESSAGE = whatsappApi.MESSAGE;

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
    return whatsappApi.digits(value);
  }

  function whatsappNumber(value) {
    return whatsappApi.normalizeNumber(value);
  }

  function whatsappUrl(value) {
    return whatsappApi.buildUrl(value);
  }

  function lessonKindLabel(kind) {
    const labels = {
      regular: "AULA REGULAR",
      makeup: "REPOSIÇÃO",
      trial: "AULA EXPERIMENTAL"
    };
    return labels[kind] || "AULA";
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Horário não definido";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatToday() {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIME_ZONE,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date());
  }

  function normalizeError(error) {
    const message = toText(error && error.message).trim();
    return message || "Não foi possível concluir a operação.";
  }

  function setMessage(documentRef, message, type) {
    const element = documentRef.getElementById("dayMessage");
    element.textContent = message || "";
    element.className = "day-message" + (type ? " " + type : "");
    element.hidden = !message;
  }

  function renderSummary(documentRef, items) {
    const counts = {
      total: items.length,
      regular: 0,
      makeup: 0,
      trial: 0
    };

    items.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(counts, item.lesson_kind)) {
        counts[item.lesson_kind] += 1;
      }
    });

    documentRef.getElementById("daySummary").innerHTML =
      '<article class="day-summary-card"><span>Total</span><strong>' + counts.total + '</strong></article>' +
      '<article class="day-summary-card"><span>Regulares</span><strong>' + counts.regular + '</strong></article>' +
      '<article class="day-summary-card"><span>Reposições</span><strong>' + counts.makeup + '</strong></article>' +
      '<article class="day-summary-card"><span>Experimentais</span><strong>' + counts.trial + '</strong></article>';
  }

  function lessonToPresentHtml(item) {
    const lesson = toText(item && item.lesson_to_present).trim();
    if (!lesson || toText(item && item.lesson_kind) === "trial") return "";
    return '<div class="day-lesson-to-present"><span>LIÇÃO A APRESENTAR</span><strong>' +
      escapeHtml(lesson) +
      '</strong></div>';
  }

  function buildCard(item) {
    const kind = toText(item.lesson_kind);
    const contactUrl = whatsappUrl(item.whatsapp);
    const contactAction = contactUrl
      ? '<a class="day-whatsapp-link" data-whatsapp-number="' + escapeHtml(whatsappNumber(item.whatsapp)) +
        '" href="' + escapeHtml(contactUrl) + '" target="_blank" rel="noopener noreferrer">FALAR NO WHATSAPP</a>'
      : '<button class="day-add-whatsapp-button" type="button" data-add-whatsapp="true">ADICIONAR WHATSAPP</button>';

    return '<article class="day-card" data-entry-id="' + escapeHtml(item.entry_id) + '" data-lesson-kind="' + escapeHtml(kind) + '">' +
      '<div class="day-card-main">' +
        '<div class="day-card-title-row">' +
          '<h3>' + escapeHtml(item.student_name || "Aluno") + '</h3>' +
          '<span class="day-pill ' + escapeHtml(kind) + '">' + escapeHtml(lessonKindLabel(kind)) + '</span>' +
        '</div>' +
        '<div class="day-card-meta">' +
          '<span>' + escapeHtml(formatTime(item.starts_at)) + '</span>' +
          '<span>' + escapeHtml(item.class_name || "Turma não definida") + '</span>' +
        '</div>' +
        lessonToPresentHtml(item) +
      '</div>' +
      '<div class="day-card-actions">' +
        contactAction +
        '<button class="day-danger-button" type="button" data-cancel-lesson="true">CANCELAR AULA</button>' +
      '</div>' +
    '</article>';
  }

  function renderStudents(documentRef, items) {
    const list = documentRef.getElementById("studentsTodayList");
    renderSummary(documentRef, items);
    list.innerHTML = items.length
      ? items.map(buildCard).join("")
      : '<p class="day-empty">Nenhum aluno possui aula agendada para hoje.</p>';
  }

  function findItem(state, entryId, lessonKind) {
    return state.items.find(function (item) {
      return item.entry_id === entryId && item.lesson_kind === lessonKind;
    }) || null;
  }

  function closeWhatsappDialog(runtime) {
    runtime.state.whatsappEntry = null;
    runtime.documentRef.getElementById("whatsappForm").reset();
    const dialog = runtime.documentRef.getElementById("whatsappDialog");
    if (dialog.open) dialog.close();
  }

  function openWhatsappDialog(runtime, item) {
    runtime.state.whatsappEntry = item;
    runtime.documentRef.getElementById("whatsappStudentName").textContent =
      "Aluno: " + (item.student_name || "Aluno");
    runtime.documentRef.getElementById("whatsappInput").value = "";
    runtime.documentRef.getElementById("whatsappDialog").showModal();
    runtime.documentRef.getElementById("whatsappInput").focus();
  }

  async function loadStudents(runtime) {
    const response = await runtime.client.rpc("get_teacher_students_of_day");
    if (response.error) throw response.error;
    runtime.state.items = Array.isArray(response.data) ? response.data : [];
    renderStudents(runtime.documentRef, runtime.state.items);
  }

  async function refresh(runtime) {
    const button = runtime.documentRef.getElementById("refreshStudentsButton");
    button.disabled = true;
    button.textContent = "ATUALIZANDO...";
    try {
      await loadStudents(runtime);
      setMessage(runtime.documentRef, "", "");
    } catch (error) {
      setMessage(runtime.documentRef, "Não foi possível carregar os alunos: " + normalizeError(error), "error");
      throw error;
    } finally {
      button.disabled = false;
      button.textContent = "ATUALIZAR";
    }
  }

  async function saveWhatsapp(runtime) {
    const item = runtime.state.whatsappEntry;
    if (!item) return;

    const input = runtime.documentRef.getElementById("whatsappInput");
    const digits = whatsappDigits(input.value);
    if (digits.length < 10 || digits.length > 15) {
      setMessage(runtime.documentRef, "Informe um número de WhatsApp válido com DDD.", "error");
      input.focus();
      return;
    }

    const button = runtime.documentRef.getElementById("whatsappSaveButton");
    button.disabled = true;
    button.textContent = "SALVANDO...";
    try {
      const response = await runtime.client.rpc("set_teacher_day_student_whatsapp", {
        target_lesson_kind: item.lesson_kind,
        target_entry_id: item.entry_id,
        target_whatsapp: input.value
      });
      if (response.error) throw response.error;
      closeWhatsappDialog(runtime);
      await loadStudents(runtime);
      setMessage(runtime.documentRef, "WhatsApp registrado nas informações do aluno.", "success");
    } catch (error) {
      setMessage(runtime.documentRef, normalizeError(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = "SALVAR WHATSAPP";
    }
  }

  async function cancelLesson(runtime, item, button) {
    const confirmation = "Cancelar a aula de " + (item.student_name || "este aluno") + " hoje?";
    if (runtime.windowRef.confirm && !runtime.windowRef.confirm(confirmation)) return;

    button.disabled = true;
    button.textContent = "CANCELANDO...";
    try {
      const response = await runtime.client.rpc("cancel_teacher_day_lesson", {
        target_lesson_kind: item.lesson_kind,
        target_entry_id: item.entry_id
      });
      if (response.error) throw response.error;
      await loadStudents(runtime);
      setMessage(runtime.documentRef, "Aula cancelada e ausência registrada.", "success");
    } catch (error) {
      setMessage(runtime.documentRef, normalizeError(error), "error");
      button.disabled = false;
      button.textContent = "CANCELAR AULA";
    }
  }

  function bindEvents(runtime) {
    const documentRef = runtime.documentRef;

    documentRef.getElementById("refreshStudentsButton").addEventListener("click", function () {
      refresh(runtime).catch(function () {});
    });

    documentRef.getElementById("studentsTodayList").addEventListener("click", function (event) {
      const card = event.target.closest("[data-entry-id][data-lesson-kind]");
      if (!card) return;
      const item = findItem(runtime.state, card.dataset.entryId, card.dataset.lessonKind);
      if (!item) return;

      const whatsappButton = event.target.closest("[data-add-whatsapp]");
      if (whatsappButton) {
        openWhatsappDialog(runtime, item);
        return;
      }

      const cancelButton = event.target.closest("[data-cancel-lesson]");
      if (cancelButton) cancelLesson(runtime, item, cancelButton).catch(function () {});
    });

    documentRef.getElementById("whatsappForm").addEventListener("submit", function (event) {
      event.preventDefault();
      saveWhatsapp(runtime).catch(function () {});
    });

    ["whatsappDialogClose", "whatsappCancelButton"].forEach(function (id) {
      documentRef.getElementById(id).addEventListener("click", function () {
        closeWhatsappDialog(runtime);
      });
    });
  }

  function dependenciesReady(windowRef) {
    return Boolean(
      windowRef.Auth &&
      typeof windowRef.Auth.getClient === "function" &&
      typeof windowRef.Auth.getSession === "function"
    );
  }

  async function waitForDependencies(windowRef) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (dependenciesReady(windowRef)) return true;
      await new Promise(function (resolve) { windowRef.setTimeout(resolve, 100); });
    }
    return false;
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;

    documentRef.getElementById("dayDateLabel").textContent = formatToday();

    if (!(await waitForDependencies(windowRef))) {
      documentRef.body.classList.remove("auth-checking");
      setMessage(documentRef, "Não foi possível carregar a autenticação administrativa.", "error");
      return false;
    }

    const session = await windowRef.Auth.getSession();
    if (!session || !session.user) {
      windowRef.location.href = "/login/?next=" + encodeURIComponent(PAGE_PATH);
      return false;
    }

    const client = windowRef.Auth.getClient();
    const adminResponse = await client.rpc("is_teacher_admin");
    if (adminResponse.error || adminResponse.data !== true) {
      windowRef.location.href = "/area-do-estudante/";
      return false;
    }

    const runtime = {
      windowRef: windowRef,
      documentRef: documentRef,
      client: client,
      state: { items: [], whatsappEntry: null }
    };

    bindEvents(runtime);
    documentRef.body.classList.remove("auth-checking");
    await refresh(runtime);
    return true;
  }

  return Object.freeze({
    DEFAULT_MESSAGE: DEFAULT_MESSAGE,
    whatsappDigits: whatsappDigits,
    whatsappNumber: whatsappNumber,
    whatsappUrl: whatsappUrl,
    lessonKindLabel: lessonKindLabel,
    lessonToPresentHtml: lessonToPresentHtml,
    formatTime: formatTime,
    initialize: initialize
  });
});

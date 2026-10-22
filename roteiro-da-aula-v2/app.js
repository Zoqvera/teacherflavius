(function () {
  "use strict";

  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  const QUESTION_BATCH_SIZE = 80;
  // Etapa 2 preparada: manter registros indisponíveis até a liberação integral.
  const PRESENTATION_REGISTRATION_ENABLED = false;
  const QUESTION_RATINGS_ENABLED = false;
  // Gate v2: servidor e interface continuam desativados nesta etapa.
  const SESSION_LIFECYCLE_ENABLED = false;
  const RATINGS = Object.freeze({
    good: "BOM",
    medium: "MÉDIO",
    improve: "MELHORAR"
  });
  const MODEL = window.TeacherWorkspaceModel;
  const state = {
    service: null,
    registration: null,
    questionRatings: null,
    lifecycle: null,
    closedSessionsAvailable: false,
    questionHistory: new Map(),
    ratingHistoryAvailable: false,
    openSections: new Map(),
    loadedDate: null,
    groups: [],
    catalog: new Map(),
    presentations: new Map(),
    view: "home",
    selectedClass: null,
    requestId: 0
  };

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined && content !== null) element.textContent = content;
    return element;
  }

  function status(message, tone) {
    const output = document.getElementById("workspaceStatus");
    output.textContent = message;
    if (tone) output.dataset.tone = tone;
    else delete output.dataset.tone;
  }

  function currentDate() {
    const segments = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
      timeZone: "America/Sao_Paulo"
    }).formatToParts(new Date());
    const parts = {};
    segments.forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function classTime(startsAt) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit", minute: "2-digit"
    }).format(new Date(startsAt));
  }

  function button(label, action, className) {
    const control = node("button", className || "workspace-navigation-card", label);
    control.type = "button";
    control.addEventListener("click", action);
    return control;
  }

  function muted(message) {
    return node("p", "academic-muted", message);
  }

  function readonlyAction(label) {
    const control = node("button", "academic-button workspace-disabled-action", label);
    control.type = "button";
    control.disabled = true;
    control.title = "Registro disponível após a validação da nova versão.";
    return control;
  }

  function formatSectionLabel() {
    return state.view === "presentations" ? "APRESENTAÇÕES DO DIA" : "PERGUNTAS DO DIA";
  }

  function setView(view, selectedClass) {
    state.view = view;
    state.selectedClass = selectedClass || null;
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function renderBreadcrumbs(group) {
    const nav = document.getElementById("workspaceBreadcrumbs");
    nav.replaceChildren();
    if (state.view === "home") return;
    nav.appendChild(button("INÍCIO", function () { setView("home"); }, "workspace-breadcrumb"));
    nav.appendChild(node("span", "academic-muted", " / "));
    if (group) {
      nav.appendChild(button(formatSectionLabel(), function () {
        setView(state.view);
      }, "workspace-breadcrumb"));
      nav.appendChild(node("span", "academic-muted", " / "));
      nav.appendChild(node("span", "workspace-breadcrumb-current", group.className));
    } else {
      nav.appendChild(node("span", "workspace-breadcrumb-current", formatSectionLabel()));
    }
  }

  function renderHome(container) {
    const grid = node("div", "workspace-grid");
    [
      { title: "APRESENTAÇÕES DO DIA", description: "Apresentações previstas por turma.", view: "presentations" },
      { title: "PERGUNTAS DO DIA", description: "Perguntas estudadas, revisões e histórico por aluno.", view: "questions" }
    ].forEach(function (entry) {
      const card = button("", function () { setView(entry.view); });
      card.appendChild(node("strong", "", entry.title));
      card.appendChild(node("span", "", entry.description));
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  function classDescription(group) {
    if (group.finalized) {
      return "AULA ENCERRADA · " + group.students.length + " aluno(s) no histórico";
    }
    const summary = MODEL.classSummary(group);
    if (state.view === "presentations") {
      return summary.presented + "/" + summary.total + " apresentações registradas" +
        (summary.cancelled ? " · " + summary.cancelled + " cancelamento(s)" : "");
    }
    return summary.total + " aluno(s) · " + summary.studiedToday +
      " pergunta(s) estudada(s) para hoje" +
      (summary.cancelled ? " · " + summary.cancelled + " cancelamento(s)" : "");
  }

  function renderClasses(container) {
    container.appendChild(node("h2", "workspace-section-title", formatSectionLabel()));
    if (!state.groups.length) {
      container.appendChild(muted("Nenhuma turma encontrada para a data selecionada."));
      return;
    }
    const grid = node("div", "workspace-grid");
    state.groups.forEach(function (group) {
      const card = button("", function () { setView(state.view, group.key); });
      card.appendChild(node("strong", "", group.className + " · " + classTime(group.startsAt)));
      card.appendChild(node("span", "", classDescription(group)));
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  async function markParticipation(item, control) {
    const date = document.getElementById("workspaceDate").value;
    if (!SESSION_LIFECYCLE_ENABLED || state.loadedDate !== date) return;
    control.disabled = true;
    control.textContent = "SALVANDO...";
    try {
      await state.lifecycle.markParticipation(item, date);
      item.attendance_status = "present";
      await loadPlan("Participação registrada. Presença confirmada.");
    } catch (error) {
      console.error("Falha no registro de participação:", error);
      status(error && error.message
        ? error.message : "Não foi possível registrar a participação.", "error");
      control.disabled = false;
      control.textContent = "REGISTRAR PARTICIPAÇÃO";
    }
  }

  function participationAction(item) {
    if (!SESSION_LIFECYCLE_ENABLED) {
      return readonlyAction("REGISTRAR PARTICIPAÇÃO");
    }
    const control = button("REGISTRAR PARTICIPAÇÃO", function () {
      markParticipation(item, control);
    }, "academic-button workspace-participation-action");
    return control;
  }

  async function correctAttendance(item, control) {
    const date = document.getElementById("workspaceDate").value;
    if (!SESSION_LIFECYCLE_ENABLED || state.loadedDate !== date) return;
    const response = window.prompt(
      "Frequência corrigida para " + item.student_name +
      ": digite PRESENTE ou AUSENTE."
    );
    if (response === null) return;
    const target = response.trim().toLocaleUpperCase("pt-BR");
    if (!["PRESENTE", "AUSENTE"].includes(target)) {
      status("Informe PRESENTE ou AUSENTE.", "error");
      return;
    }
    const reason = window.prompt(
      "Justificativa obrigatória para corrigir a frequência (8 a 500 caracteres):"
    );
    if (reason === null) return;

    control.disabled = true;
    try {
      await state.lifecycle.correctAttendance(
        item, date, target === "PRESENTE" ? "present" : "absent", reason
      );
      await loadPlan("Frequência corrigida com justificativa registrada.");
    } catch (error) {
      console.error("Falha na correção da frequência:", error);
      status(error && error.message
        ? error.message : "Não foi possível corrigir a frequência.", "error");
      control.disabled = false;
    }
  }

  function closedStudent(item) {
    const card = node("article", "academic-student-card workspace-student");
    card.appendChild(studentHeading(item));
    card.appendChild(muted("Registro preservado no encerramento da aula."));
    if (!MODEL.isCancelled(item) && window.TeacherSessionLifecycle.canAdjust(
      item, document.getElementById("workspaceDate").value
    )) {
      if (!SESSION_LIFECYCLE_ENABLED) {
        card.appendChild(readonlyAction("CORRIGIR FREQUÊNCIA"));
      } else {
        const control = button("CORRIGIR FREQUÊNCIA", function () {
          correctAttendance(item, control);
        }, "academic-button workspace-correction-action");
        card.appendChild(control);
      }
    }
    return card;
  }

  function renderClosedGroup(container, group) {
    container.appendChild(node("h2", "workspace-section-title",
      group.className + " · " + classTime(group.startsAt)));
    container.appendChild(node("p", "workspace-closed-status",
      "AULA ENCERRADA AUTOMATICAMENTE OU PELO PROFESSOR"));
    if (!group.students.length) {
      container.appendChild(muted("Aula encerrada. Histórico nominal anterior indisponível."));
    }
    group.students.forEach(function (item) {
      const student = Object.assign({}, item, { starts_at: group.startsAt });
      container.appendChild(closedStudent(student));
    });
  }

  function studentHeading(item) {
    const heading = node("div", "workspace-student-heading");
    const title = node("h3", "", item.student_name);
    heading.appendChild(title);
    const description = item.lesson_kind === "makeup" ? "Reposição" : "Aula regular";
    heading.appendChild(node("span", "academic-muted", description));
    const pill = node("span", "academic-pill", MODEL.isCancelled(item)
      ? "AULA CANCELADA"
      : item.attendance_status === "present" ? "PRESENTE"
        : item.attendance_status === "absent" ? "AUSENTE" : "AGUARDANDO");
    heading.appendChild(pill);
    return heading;
  }

  function presentationFor(item) {
    const key = window.TeacherLessonPresentations.rosterKey(
      item.student_id, item.lesson_number
    );
    return key ? state.presentations.get(key) : null;
  }

  function renderPresentation(item) {
    const card = node("article", "academic-student-card workspace-student");
    card.appendChild(studentHeading(item));
    if (MODEL.isCancelled(item)) {
      card.appendChild(muted("Aula cancelada. Nenhum registro de apresentação nesta prévia."));
      return card;
    }
    card.appendChild(node("p", "workspace-lesson-label", item.lesson_number
      ? "APRESENTAÇÃO " + item.lesson_number : "APRESENTAÇÕES CONCLUÍDAS"));
    const presentation = presentationFor(item);
    if (item.lesson_status === "presented") {
      card.appendChild(node("span", "academic-pill presented", "APRESENTAÇÃO REGISTRADA"));
    } else if (window.TeacherPresentationRegistration.canRegister(item)) {
      card.appendChild(presentationAction(item));
    } else if (item.lesson_number) {
      card.appendChild(muted("Registro indisponível para esta ocorrência."));
    }
    if (!presentation) {
      card.appendChild(muted("APRESENTAÇÃO NÃO ENVIADA"));
    } else {
      card.appendChild(node("p", "workspace-presentation-text", presentation.body));
      card.appendChild(muted("Versão " + presentation.revision_number));
    }
    return card;
  }

  async function registerPresentation(item, control) {
    const classDate = document.getElementById("workspaceDate").value;
    if (!PRESENTATION_REGISTRATION_ENABLED || state.view !== "presentations" ||
        state.loadedDate !== classDate) {
      status("Atualize o roteiro antes de registrar uma apresentação.", "error");
      return;
    }

    control.disabled = true;
    control.textContent = "SALVANDO...";
    try {
      await state.registration.register(item, classDate);
      // The existing RPC atomically confirms attendance and lesson completion.
      item.lesson_status = "presented";
      item.attendance_status = "present";
      render();
      await loadPlan("Apresentação " + item.lesson_number +
        " registrada para " + item.student_name + ". Presença confirmada.");
    } catch (error) {
      console.error("Falha ao registrar apresentação:", error);
      status(error && error.message
        ? error.message : "Não foi possível confirmar a apresentação.", "error");
      control.textContent = "REGISTRAR APRESENTAÇÃO";
      control.disabled = false;
    }
  }

  function presentationAction(item) {
    if (!PRESENTATION_REGISTRATION_ENABLED) {
      return readonlyAction("REGISTRAR APRESENTAÇÃO");
    }
    const control = button("REGISTRAR APRESENTAÇÃO", function () {
      registerPresentation(item, control);
    }, "academic-button primary workspace-save-action");
    return control;
  }

  function questionHistory(item) {
    return state.questionHistory.get(window.TeacherQuestionRatings.occurrenceKey(item)) || [];
  }

  function evaluationSummary(questionId, history) {
    const ratings = window.TeacherQuestionRatings;
    const current = ratings.currentRating(history, questionId);
    const latest = current || ratings.latestRating(history, questionId);
    if (!latest) return null;
    const label = current ? "AVALIADA NESTA AULA" : "ÚLTIMA AVALIAÇÃO";
    return label + ": " + ratings.ratingLabel(latest.rating);
  }

  async function rateQuestion(item, question, rating, control) {
    const date = document.getElementById("workspaceDate").value;
    if (!QUESTION_RATINGS_ENABLED || !state.ratingHistoryAvailable ||
        state.view !== "questions" || state.loadedDate !== date) {
      status("Atualize o roteiro antes de avaliar uma pergunta.", "error");
      return;
    }

    const questionId = question.id;
    const controls = Array.from(
      control.closest(".academic-rating-actions").querySelectorAll("button")
    );
    controls.forEach(function (button) { button.disabled = true; });
    control.textContent = "SALVANDO...";
    try {
      const result = await state.questionRatings.rate(
        item, date, questionId, rating, questionHistory(item)
      );
      if (document.getElementById("workspaceDate").value !== date ||
          state.loadedDate !== date) return;
      const key = window.TeacherQuestionRatings.occurrenceKey(item);
      const records = state.questionHistory.get(key) || [];
      if (!window.TeacherQuestionRatings.currentRating(records, questionId)) {
        state.questionHistory.set(key, [{
          question_id: questionId,
          rating: result.rating,
          is_current: true,
          practiced_at: new Date().toISOString(),
          lesson_starts_at: item.starts_at
        }].concat(records));
      }
      item.attendance_status = "present";
      render();
      await loadPlan(
        "Pergunta avaliada como " +
          window.TeacherQuestionRatings.ratingLabel(result.rating) +
          ". Presença confirmada."
      );
    } catch (error) {
      console.error("Falha ao avaliar pergunta:", error);
      status(error && error.message ? error.message :
        "Não foi possível registrar a avaliação.", "error");
      control.textContent = RATINGS[rating];
      controls.forEach(function (button) { button.disabled = false; });
    }
  }

  function questionRatingActions(item, question, history) {
    const actions = node("div", "academic-rating-actions");
    const date = document.getElementById("workspaceDate").value;
    if (!QUESTION_RATINGS_ENABLED || !state.ratingHistoryAvailable) {
      Object.keys(RATINGS).forEach(function (rating) {
        actions.appendChild(readonlyAction(RATINGS[rating]));
      });
      return actions;
    }
    if (!window.TeacherQuestionRatings.canRate(item, date, question.id, history)) {
      return actions;
    }
    Object.keys(RATINGS).forEach(function (rating) {
      const control = button(RATINGS[rating], function () {
        rateQuestion(item, question, rating, control);
      }, "academic-button" + (rating === "good" ? " success" : ""));
      actions.appendChild(control);
    });
    return actions;
  }

  function questionCard(question, item, showRatings, history) {
    const wrapper = node("div", "workspace-question");
    wrapper.appendChild(window.ConversationQuestionCardRenderer.create(question, {
      number: question.display_order,
      className: "academic-conversation-card academic-teacher-question-card"
    }));
    const lastRating = evaluationSummary(question.id, history);
    if (lastRating) {
      wrapper.appendChild(node("p", "workspace-rating-history", lastRating));
    }
    if (showRatings &&
        !window.TeacherQuestionRatings.currentRating(history, question.id)) {
      wrapper.appendChild(questionRatingActions(item, question, history));
    }
    return wrapper;
  }

  function questionSection(label, questions, item, expanded, showRatings, history) {
    const section = node("details", "workspace-question-section");
    const key = window.TeacherQuestionRatings.occurrenceKey(item) + "|" + label;
    section.open = state.openSections.has(key)
      ? state.openSections.get(key) : expanded;
    section.addEventListener("toggle", function () {
      state.openSections.set(key, section.open);
    });
    section.appendChild(node("summary", "", label + " (" + questions.length + ")"));
    const content = node("div", "workspace-question-list");
    if (!questions.length) content.appendChild(muted("Nenhuma pergunta nesta seção."));
    const rows = questions.map(function (question) {
      const card = questionCard(question, item, showRatings, history);
      content.appendChild(card);
      return { card: card, question: question };
    });
    if (label === "TODAS AS PERGUNTAS ESTUDADAS" && rows.length) {
      const search = node("input", "workspace-question-search");
      search.type = "search";
      search.placeholder = "Buscar pergunta estudada";
      search.setAttribute("aria-label", "Buscar entre todas as perguntas estudadas");
      search.addEventListener("input", function () {
        const term = search.value.trim().toLocaleLowerCase("pt-BR");
        rows.forEach(function (row) {
          const text = String(row.question.text || row.question.question_text || "") +
            " " + String(row.question.translation || row.question.question_translation || "") +
            " " + String(row.question.display_order || "");
          row.card.hidden = !text.toLocaleLowerCase("pt-BR").includes(term);
        });
      });
      section.appendChild(search);
    }
    section.appendChild(content);
    return section;
  }

  function renderQuestions(item) {
    const card = node("article", "academic-student-card workspace-student");
    card.appendChild(studentHeading(item));
    if (MODEL.isCancelled(item)) {
      card.appendChild(muted("Aula cancelada. Histórico disponível apenas para consulta."));
    }
    const questions = MODEL.questionsForStudent(item, state.catalog);
    const history = questionHistory(item);
    if (!MODEL.isCancelled(item) && item.attendance_status === "scheduled") {
      card.appendChild(participationAction(item));
    }
    card.appendChild(questionSection(
      "PERGUNTAS ESTUDADAS PARA HOJE", questions.today, item, true,
      !MODEL.isCancelled(item), history
    ));
    card.appendChild(questionSection(
      "PERGUNTAS A SEREM REVISADAS", questions.review, item, false,
      !MODEL.isCancelled(item), history
    ));
    card.appendChild(questionSection(
      "TODAS AS PERGUNTAS ESTUDADAS", questions.all, item, false, false, history
    ));
    return card;
  }

  function renderClass(container, group) {
    if (group.finalized) {
      renderClosedGroup(container, group);
      return;
    }
    container.appendChild(node("h2", "workspace-section-title",
      group.className + " · " + classTime(group.startsAt)));
    container.appendChild(muted(formatSectionLabel()));
    const active = group.students.filter(function (student) {
      return !MODEL.isCancelled(student);
    });
    const cancelled = group.students.filter(MODEL.isCancelled);
    active.forEach(function (item) {
      container.appendChild(state.view === "presentations"
        ? renderPresentation(item) : renderQuestions(item));
    });
    if (cancelled.length) {
      container.appendChild(node("h3", "workspace-section-title", "AULAS CANCELADAS"));
      cancelled.forEach(function (item) {
        container.appendChild(state.view === "presentations"
          ? renderPresentation(item) : renderQuestions(item));
      });
    }
  }

  function render() {
    const content = document.getElementById("workspaceContent");
    content.replaceChildren();
    const group = state.groups.find(function (item) {
      return item.key === state.selectedClass;
    });
    renderBreadcrumbs(group);
    if (state.view === "home") renderHome(content);
    else if (group) renderClass(content, group);
    else renderClasses(content);
  }

  async function loadQuestionCatalog(client, items) {
    const numbers = MODEL.studiedNumbers(items);
    const catalog = new Map();
    for (let position = 0; position < numbers.length; position += QUESTION_BATCH_SIZE) {
      const chunk = numbers.slice(position, position + QUESTION_BATCH_SIZE);
      const result = await client.from("conversation_questions")
        .select("id,display_order,question_text,question_translation,answer_examples")
        .in("display_order", chunk);
      if (result.error) throw result.error;
      (result.data || []).forEach(function (question) {
        catalog.set(Number(question.display_order), question);
      });
    }
    return catalog;
  }

  async function loadPlan(successMessage) {
    const requestId = ++state.requestId;
    const date = document.getElementById("workspaceDate").value;
    status("Carregando turmas...", "");
    try {
      const client = window.Auth.getClient();
      const items = await state.service.getTeacherLessonPlan(date);
      const [catalog, bundle, questionHistory, closedSessions] = await Promise.all([
        loadQuestionCatalog(client, items),
        window.TeacherLessonPresentations.loadPlan(
          items, function () { return client; }, state.teacherId
        ),
        state.questionRatings.getHistory(date),
        state.lifecycle.getClosedSessions(date)
      ]);
      if (requestId !== state.requestId) return;
      state.groups = MODEL.groupByClass(items).concat(
        closedSessions.sessions
      ).sort(function (first, second) {
        return new Date(first.startsAt).getTime() -
          new Date(second.startsAt).getTime();
      });
      state.closedSessionsAvailable = closedSessions.available;
      state.loadedDate = date;
      state.catalog = catalog;
      state.presentations = bundle ? bundle.records : new Map();
      state.ratingHistoryAvailable = questionHistory.available;
      state.questionHistory = questionHistory.byOccurrence;
      if (state.selectedClass && !state.groups.some(function (group) {
        return group.key === state.selectedClass;
      })) state.selectedClass = null;
      render();
      status(successMessage || state.groups.length +
        " turma(s) carregada(s). Registros na prévia ainda desativados." +
        (state.ratingHistoryAvailable ? "" : " Histórico de avaliações ainda não disponível."),
        "success");
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.error("Falha ao carregar a prévia:", error);
      status(error && error.message ? error.message : "Falha ao carregar a prévia.", "error");
    }
  }

  async function initialize() {
    const ready = await window.ResourceWaiter.waitUntil(function () {
      return Boolean(window.Auth && window.Auth.isConfigured() &&
        window.AcademicWorkflowService &&
        window.TeacherLessonPresentations &&
        window.ConversationQuestionCardRenderer &&
        window.TeacherPresentationRegistration &&
        window.TeacherQuestionRatings &&
        window.TeacherSessionLifecycle && MODEL);
    }, WAIT_OPTIONS);
    if (!ready) {
      status("Recursos indisponíveis.", "error");
      document.body.classList.remove("auth-checking");
      return;
    }
    const session = await window.Auth.getSession();
    if (!session || !session.user) {
      window.location.href = "/login/?next=" + encodeURIComponent("/roteiro-da-aula-v2/");
      return;
    }
    const client = window.Auth.getClient();
    const permission = await client.rpc("is_teacher_admin");
    if (permission.error || permission.data !== true) {
      window.location.href = "/acesso-negado/";
      return;
    }
    state.teacherId = session.user.id;
    state.service = window.AcademicWorkflowService.create(client);
    state.registration = window.TeacherPresentationRegistration.create({
      markLessonPresented: async function (item, date) {
        const response = await client.rpc("mark_teacher_lesson_presented_v2", {
          target_lesson_kind: item.lesson_kind,
          target_entry_id: item.entry_id,
          target_date: date,
          target_lesson_number: item.lesson_number
        });
        if (response.error) throw response.error;
        return response.data;
      }
    });
    state.questionRatings = window.TeacherQuestionRatings.create(client);
    state.lifecycle = window.TeacherSessionLifecycle.create(client);
    const datePicker = document.getElementById("workspaceDate");
    datePicker.value = currentDate();
    datePicker.addEventListener("change", function () {
      setView("home");
      loadPlan();
    });
    document.getElementById("workspaceReload").addEventListener("click", function () {
      loadPlan();
    });
    document.body.classList.remove("auth-checking");
    await loadPlan();
  }

  initialize().catch(function (error) {
    console.error("Falha na inicialização do Roteiro v2:", error);
    status("Não foi possível abrir a prévia.", "error");
    document.body.classList.remove("auth-checking");
  });
})();

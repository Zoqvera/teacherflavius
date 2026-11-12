(function () {
  "use strict";

  const LOGIN_PATH = "/login/";
  const PAGE_PATH = "/conversation-questions/";
  const AUTH_MAX_ATTEMPTS = 40;
  const AUTH_RETRY_DELAY_MS = 100;

  const state = {
    session: null,
    isTeacher: false,
    questions: [],
    completions: new Set(),
    studyByQuestionId: new Map(),
    service: null,
    academicService: null,
    reordering: false
  };

  const ui = {};

  function cacheUi() {
    ui.status = document.getElementById("conversationStatus");
    ui.questionList = document.getElementById("conversationQuestionList");
    ui.modeLabel = document.getElementById("conversationModeLabel");
    ui.professorLink = document.getElementById("conversationProfessorLink");
    ui.questionCount = document.getElementById("conversationQuestionCount");
    ui.count = document.getElementById("conversationCount");
    ui.listHelp = document.getElementById("conversationListHelp");
  }

  function showStatus(message, tone) {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.tone = tone || "neutral";
    ui.status.hidden = false;
  }

  function clearStatus() {
    if (!ui.status) return;
    ui.status.hidden = true;
    ui.status.textContent = "";
    delete ui.status.dataset.tone;
  }

  function authResourcesAreReady() {
    return !!(
      window.Auth &&
      window.ResourceWaiter &&
      window.ConversationQuestionsService &&
      window.ConversationQuestionCardRenderer &&
      window.AcademicWorkflowService &&
      typeof window.Auth.getSession === "function" &&
      typeof window.Auth.getClient === "function"
    );
  }

  async function waitForAuthResources() {
    if (!window.ResourceWaiter) return false;
    return window.ResourceWaiter.waitUntil(authResourcesAreReady, {
      maxAttempts: AUTH_MAX_ATTEMPTS,
      delayMs: AUTH_RETRY_DELAY_MS
    });
  }

  function redirectToLogin() {
    const next = window.Auth.normalizeNextPath(window.location.pathname, PAGE_PATH);
    window.location.href = LOGIN_PATH + "?next=" + encodeURIComponent(next);
  }

  function createSvgIcon(pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    pathData.forEach(function (data) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", data);
      svg.appendChild(path);
    });
    return svg;
  }

  function completionKey(questionId, studentId) {
    return window.ConversationQuestionsService.completionKey(questionId, studentId);
  }

  function isCompleted(questionId, studentId) {
    return state.completions.has(completionKey(questionId, studentId));
  }

  function createOrderButton(question, direction, disabled) {
    const button = document.createElement("button");
    const isUp = direction === "up";
    button.type = "button";
    button.className = "conversation-order-button";
    button.disabled = disabled || state.reordering;
    button.setAttribute("aria-label", isUp ? "Mover pergunta para cima" : "Mover pergunta para baixo");
    button.appendChild(createSvgIcon(
      isUp
        ? ["M12 19V5", "m5 12 7-7 7 7"]
        : ["M12 5v14", "m19 12-7 7-7-7"]
    ));

    const label = document.createElement("span");
    label.textContent = isUp ? "Subir" : "Descer";
    button.appendChild(label);

    button.addEventListener("click", function () {
      reorderQuestion(question.id, direction);
    });
    return button;
  }

  function createQuestionContent(question, index, element, className) {
    return window.ConversationQuestionCardRenderer.create(question, {
      element: element,
      className: className,
      number: index + 1
    });
  }

  function createTeacherQuestionCard(question, index) {
    const article = document.createElement("article");
    article.className = "conversation-question-admin-card";

    const top = document.createElement("div");
    top.className = "conversation-question-top";
    top.appendChild(createQuestionContent(
      question,
      index,
      "div",
      "conversation-question-content"
    ));

    const controls = document.createElement("div");
    controls.className = "conversation-order-controls";
    controls.appendChild(createOrderButton(question, "up", index === 0));
    controls.appendChild(createOrderButton(question, "down", index === state.questions.length - 1));
    top.appendChild(controls);

    article.appendChild(top);
    return article;
  }

  function createStudentProgress(question) {
    const completed = isCompleted(question.id, state.session.user.id);
    const progress = document.createElement("div");
    progress.className = "conversation-student-progress";
    progress.dataset.completed = completed ? "true" : "false";

    progress.appendChild(createSvgIcon(
      completed
        ? ["M20 6 9 17l-5-5"]
        : ["M12 8v5", "M12 17h.01", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"]
    ));

    const label = document.createElement("span");
    label.textContent = completed
      ? "Respondida corretamente"
      : "Ainda não respondida corretamente";
    progress.appendChild(label);

    return progress;
  }

  function studentStudyButtonState(questionId) {
    const progress = state.studyByQuestionId.get(questionId);

    // Never allow another registration without confirmed per-student progress.
    if (!progress || typeof progress.marked_studied !== "boolean") {
      return { label: "ESTUDO INDISPONÍVEL", disabled: true };
    }
    if (progress.marked_studied) {
      return { label: "PERGUNTA ESTUDADA", disabled: true };
    }
    if (progress.worked || progress.studied) {
      return { label: "PERGUNTA JÁ TRABALHADA", disabled: true };
    }
    return { label: "REGISTRAR ESTUDO", disabled: false };
  }

  async function markStudentQuestionStudied(questionId, button) {
    if (button.disabled || studentStudyButtonState(questionId).disabled) return;

    button.disabled = true;
    button.textContent = "REGISTRANDO...";

    try {
      const saved = await state.academicService.markQuestionStudied(questionId);
      if (!saved || saved.ok !== true) {
        throw new Error("Não foi possível confirmar o registro da pergunta.");
      }

      const previous = state.studyByQuestionId.get(questionId);
      state.studyByQuestionId.set(questionId, Object.assign({}, previous, {
        marked_studied: true,
        studied: true
      }));

      renderQuestions();
      showStatus("Pergunta marcada como estudada.", "success");
    } catch (error) {
      console.error("Falha ao registrar a pergunta estudada:", error);
      button.disabled = false;
      button.textContent = "REGISTRAR ESTUDO";
      showStatus(
        error && error.message ? error.message : "Não foi possível registrar a pergunta.",
        "error"
      );
    }
  }

  function createStudentStudyAction(question) {
    const action = document.createElement("div");
    action.className = "conversation-student-study-action";

    const button = document.createElement("button");
    const status = studentStudyButtonState(question.id);
    button.type = "button";
    button.className = "conversation-study-button";
    button.textContent = status.label;
    button.disabled = status.disabled;
    button.addEventListener("click", function () {
      void markStudentQuestionStudied(question.id, button);
    });

    action.appendChild(button);
    return action;
  }

  function createStudentQuestionCard(question, index) {
    const card = createQuestionContent(
      question,
      index,
      "article",
      "conversation-question-student-card"
    );
    card.appendChild(createStudentProgress(question));
    card.appendChild(createStudentStudyAction(question));
    return card;
  }

  function renderQuestions() {
    if (window.ConversationQuestionAudio) window.ConversationQuestionAudio.stop();
    ui.questionList.textContent = "";
    ui.questionCount.textContent = String(state.questions.length);
    ui.count.hidden = false;

    if (!state.questions.length) {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = "Nenhuma pergunta cadastrada.";
      ui.questionList.appendChild(empty);
      return;
    }

    state.questions.forEach(function (question, index) {
      ui.questionList.appendChild(
        state.isTeacher
          ? createTeacherQuestionCard(question, index)
          : createStudentQuestionCard(question, index)
      );
    });
  }

  async function reorderQuestion(questionId, direction) {
    if (state.reordering) return;
    state.reordering = true;
    renderQuestions();
    showStatus("Salvando a nova ordem...", "neutral");

    try {
      await state.service.moveQuestion(questionId, direction);
      state.questions = await state.service.listQuestions();
      renderQuestions();
      showStatus("Ordem das perguntas atualizada.", "success");
    } catch (error) {
      showStatus("Não foi possível alterar a ordem das perguntas.", "error");
      console.error("Falha ao reordenar Conversation Questions:", error);
    } finally {
      state.reordering = false;
      renderQuestions();
    }
  }

  async function loadTeacherView() {
    ui.modeLabel.textContent = "VISÃO DO PROFESSOR";
    ui.professorLink.hidden = false;
    ui.listHelp.textContent = "Cada card reúne a pergunta, a tradução e cinco exemplos de resposta.";

    state.questions = await state.service.listQuestions();

    renderQuestions();
    clearStatus();
  }

  async function loadStudentView() {
    ui.modeLabel.textContent = "MEU PROGRESSO";
    ui.professorLink.hidden = true;
    ui.listHelp.textContent = "Cada card traz tradução, cinco modelos de resposta e o botão de registro do estudo.";

    const student = await state.service.getStudentProfile(state.session.user.id);
    if (!student || student.enrolled !== true || student.archived === true) {
      ui.questionList.textContent = "";
      showStatus("Esta página está disponível apenas para alunos ativos.", "error");
      return;
    }

    const results = await Promise.all([
      state.service.listQuestions(),
      state.service.listStudentCompletions(state.session.user.id)
    ]);

    state.questions = results[0];
    state.completions = new Set(
      results[1].map(function (row) {
        return completionKey(row.question_id, row.student_id);
      })
    );

    try {
      const plan = await state.academicService.getMyActionPlan();
      if (!plan || !Array.isArray(plan.questions)) {
        throw new Error("Plano de estudo indisponível.");
      }

      state.studyByQuestionId = new Map(plan.questions.map(function (question) {
        return [question.id, question];
      }));
      renderQuestions();
      clearStatus();
    } catch (error) {
      // Keep the catalog readable, but never allow an unverified study write.
      state.studyByQuestionId.clear();
      renderQuestions();
      showStatus("Não foi possível verificar os estudos registrados. Recarregue a página.", "error");
      console.error("Falha ao verificar as perguntas estudadas:", error);
    }
  }

  async function initialize() {
    cacheUi();
    showStatus("Carregando Conversation Questions...", "neutral");

    try {
      const ready = await waitForAuthResources();
      if (!ready) throw new Error("Recursos de autenticação indisponíveis.");

      state.session = await window.Auth.getSession();
      if (!state.session || !state.session.user) {
        redirectToLogin();
        return;
      }

      const client = window.Auth.getClient();
      state.service = window.ConversationQuestionsService.create(client);
      state.isTeacher = await window.Auth.isTeacherAdmin();
      if (!state.isTeacher) {
        state.academicService = window.AcademicWorkflowService.create(client);
      }

      if (state.isTeacher) await loadTeacherView();
      else await loadStudentView();

      document.body.classList.remove("auth-checking");
    } catch (error) {
      document.body.classList.remove("auth-checking");
      showStatus("Não foi possível carregar Conversation Questions.", "error");
      console.error("Falha ao inicializar Conversation Questions:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

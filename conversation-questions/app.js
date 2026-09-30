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
    students: [],
    completions: new Set(),
    service: null,
    reordering: false
  };

  const ui = {};

  function cacheUi() {
    ui.status = document.getElementById("conversationStatus");
    ui.teacherTools = document.getElementById("teacherConversationTools");
    ui.questionForm = document.getElementById("conversationQuestionForm");
    ui.questionInput = document.getElementById("conversationQuestionInput");
    ui.questionList = document.getElementById("conversationQuestionList");
    ui.modeLabel = document.getElementById("conversationModeLabel");
    ui.professorLink = document.getElementById("conversationProfessorLink");
    ui.questionCount = document.getElementById("conversationQuestionCount");
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

  function studentDisplayName(student) {
    return student.name || student.email || "Aluno";
  }

  function createQuestionHeading(question, index) {
    const heading = document.createElement("div");
    heading.className = "conversation-question-heading";

    const number = document.createElement("span");
    number.className = "conversation-question-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const text = document.createElement("h2");
    text.className = "conversation-question-text";
    text.textContent = question.question_text;

    heading.appendChild(number);
    heading.appendChild(text);
    return heading;
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

  function countQuestionCompletions(questionId) {
    return state.students.reduce(function (total, student) {
      return total + (isCompleted(questionId, student.id) ? 1 : 0);
    }, 0);
  }

  function updateTeacherSummary(summary, questionId) {
    const completed = countQuestionCompletions(questionId);
    summary.textContent = completed + " de " + state.students.length + " alunos responderam corretamente.";
  }

  function createStudentCheckbox(question, student, summary) {
    const label = document.createElement("label");
    label.className = "conversation-student-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isCompleted(question.id, student.id);
    checkbox.dataset.questionId = question.id;
    checkbox.dataset.studentId = student.id;

    const name = document.createElement("span");
    name.textContent = studentDisplayName(student);

    checkbox.addEventListener("change", async function () {
      const desired = checkbox.checked;
      checkbox.disabled = true;

      try {
        await state.service.setCompletion(
          question.id,
          student.id,
          desired,
          state.session.user.id
        );

        const key = completionKey(question.id, student.id);
        if (desired) state.completions.add(key);
        else state.completions.delete(key);

        updateTeacherSummary(summary, question.id);
        showStatus(
          desired
            ? studentDisplayName(student) + " marcado como respondido corretamente."
            : studentDisplayName(student) + " desmarcado nesta pergunta.",
          "success"
        );
      } catch (error) {
        checkbox.checked = !desired;
        showStatus("Não foi possível salvar a alteração. Tente novamente.", "error");
        console.error("Falha ao atualizar Conversation Questions:", error);
      } finally {
        checkbox.disabled = false;
      }
    });

    label.appendChild(checkbox);
    label.appendChild(name);
    return label;
  }

  function createTeacherQuestionCard(question, index) {
    const article = document.createElement("article");
    article.className = "conversation-question-card";

    const top = document.createElement("div");
    top.className = "conversation-question-top";
    top.appendChild(createQuestionHeading(question, index));

    const controls = document.createElement("div");
    controls.className = "conversation-order-controls";
    controls.appendChild(createOrderButton(question, "up", index === 0));
    controls.appendChild(createOrderButton(question, "down", index === state.questions.length - 1));
    top.appendChild(controls);

    const summary = document.createElement("p");
    summary.className = "conversation-question-summary";
    updateTeacherSummary(summary, question.id);

    const students = document.createElement("div");
    students.className = "conversation-student-grid";

    state.students.forEach(function (student) {
      students.appendChild(createStudentCheckbox(question, student, summary));
    });

    article.appendChild(top);
    article.appendChild(summary);

    if (state.students.length) {
      article.appendChild(students);
    } else {
      const empty = document.createElement("p");
      empty.className = "conversation-empty";
      empty.textContent = "Nenhum aluno ativo está disponível.";
      article.appendChild(empty);
    }

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

  function createStudentQuestionCard(question, index) {
    const article = document.createElement("article");
    article.className = "conversation-question-card conversation-question-card-student";
    article.appendChild(createQuestionHeading(question, index));
    article.appendChild(createStudentProgress(question));
    return article;
  }

  function renderQuestions() {
    ui.questionList.textContent = "";
    ui.questionCount.textContent = String(state.questions.length);

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

  async function handleAddQuestion(event) {
    event.preventDefault();
    const submit = ui.questionForm.querySelector('button[type="submit"]');
    const text = ui.questionInput.value.trim();

    if (!text) {
      showStatus("Digite uma pergunta antes de adicionar.", "error");
      ui.questionInput.focus();
      return;
    }

    submit.disabled = true;

    try {
      const maxOrder = state.questions.reduce(function (largest, question) {
        return Math.max(largest, Number(question.display_order) || 0);
      }, 0);
      const question = await state.service.addQuestion(text, maxOrder + 1);
      state.questions.push(question);
      state.questions.sort(function (a, b) {
        return a.display_order - b.display_order;
      });
      ui.questionInput.value = "";
      renderQuestions();
      showStatus("Nova pergunta adicionada.", "success");
    } catch (error) {
      showStatus(error && error.message ? error.message : "Não foi possível adicionar a pergunta.", "error");
      console.error("Falha ao adicionar Conversation Question:", error);
    } finally {
      submit.disabled = false;
    }
  }

  async function loadTeacherView() {
    ui.modeLabel.textContent = "VISÃO DO PROFESSOR";
    ui.teacherTools.hidden = false;
    ui.professorLink.hidden = false;
    ui.listHelp.textContent = "As caixas marcadas indicam respostas já realizadas corretamente.";

    const results = await Promise.all([
      state.service.listQuestions(),
      state.service.listActiveStudents(),
      state.service.listAllCompletions()
    ]);

    state.questions = results[0];
    state.students = results[1];
    state.completions = new Set(
      results[2].map(function (row) {
        return completionKey(row.question_id, row.student_id);
      })
    );

    renderQuestions();
    clearStatus();
  }

  async function loadStudentView() {
    ui.modeLabel.textContent = "MEU PROGRESSO";
    ui.teacherTools.hidden = true;
    ui.professorLink.hidden = true;
    ui.listHelp.textContent = "Seu progresso é mostrado ao lado de cada pergunta.";

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

    renderQuestions();
    clearStatus();
  }

  async function initialize() {
    cacheUi();
    ui.questionForm.addEventListener("submit", handleAddQuestion);
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

(function () {
  "use strict";

  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  let service = null;

  function isSecondPartPage() {
    return String(window.location.pathname || "").replace(/\/+$/, "") ===
      "/o-que-fazer/segunda-parte";
  }

  function isNewFlowEnabled() {
    return !!(window.StudentPreparationFlow && window.StudentPreparationFlow.enabled === true);
  }

  function trackPreparation(eventName) {
    const flow = window.StudentPreparationFlow;
    if (flow && typeof flow.track === "function") flow.track(eventName);
  }

  function updateQuestionCount(elementId, count) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = String(count);
    element.setAttribute("aria-label", count + " perguntas");
  }

  function showWelcome() {
    const welcome = document.getElementById("studentPreparationWelcome");
    const legacy = document.getElementById("legacyActionPlan");
    const description = document.getElementById("legacyActionPlanDescription");
    if (welcome) welcome.hidden = false;
    if (legacy) legacy.hidden = true;
    if (description) description.hidden = true;
  }

  async function loadWelcome() {
    try {
      const plan = await service.getMyActionPlan();
      const lesson = plan && plan.lesson;
      const button = document.getElementById("startPreparationButton");
      const fallback = document.getElementById("startConversationFallback");
      const lessonUrl = lesson && lesson.has_material
        ? window.AcademicWorkflowService.lessonUrl(lesson.number)
        : "";

      button.disabled = !lessonUrl;
      if (lessonUrl) {
        fallback.hidden = true;
        button.onclick = function () {
          trackPreparation("preparation_lesson_view");
          window.location.href = lessonUrl;
        };
        setStatus("welcomePreparationStatus", "Sua próxima lição está disponível.");
      } else {
        fallback.hidden = false;
        const message = lesson
          ? "O material da próxima lição ainda não foi publicado. Você pode preparar a conversação."
          : "Não há uma próxima lição disponível. Você pode preparar a conversação.";
        setStatus("welcomePreparationStatus", message);
      }
      setStatus("actionPlanStatus", "", "");
    } catch (error) {
      console.error("Falha ao carregar a próxima lição:", error);
      setStatus("welcomePreparationStatus", "Não foi possível consultar sua próxima lição.", "error");
      setStatus("actionPlanStatus", "Não foi possível carregar seu plano de preparação.", "error");
    }
  }

  function resourcesReady() {
    return !!(
      window.Auth &&
      window.ResourceWaiter &&
      window.AcademicWorkflowService &&
      window.ConversationQuestionCardRenderer &&
      window.SUPABASE_CONFIG &&
      window.Auth.isConfigured()
    );
  }

  function setStatus(elementId, message, tone) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = message;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  function redirectToLogin() {
    const nextPath = isSecondPartPage() ? "/o-que-fazer/segunda-parte/" : "/o-que-fazer/";
    window.location.href = "/login/?next=" + encodeURIComponent(nextPath);
  }

  function lessonStatusLabel(lesson) {
    return lesson.prepared ? "ALUNO PREPARADO" : "PREVISTA";
  }

  function renderLesson(plan) {
    const container = document.getElementById("nextLessonContainer");
    if (!container) return;
    const lesson = plan.lesson;
    container.innerHTML = "";

    if (!lesson) {
      container.className = "academic-empty";
      container.textContent = "Você concluiu todas as lições disponíveis.";
      return;
    }

    if (!lesson.has_material) {
      container.className = "academic-empty";
      container.textContent = "A Lição " + lesson.number + " está prevista, mas o material ainda não foi publicado.";
      return;
    }

    container.className = "";
    const link = document.createElement("a");
    link.className = "academic-card-link";
    link.href = window.AcademicWorkflowService.lessonUrl(lesson.number);

    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = "Lição " + lesson.number;
    const status = document.createElement("small");
    status.textContent = "Status: " + lessonStatusLabel(lesson);
    text.appendChild(title);
    text.appendChild(status);

    const arrow = document.createElement("span");
    arrow.className = "academic-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    link.appendChild(text);
    link.appendChild(arrow);
    container.appendChild(link);
  }

  function showQuestionStudiedDialog() {
    if (!isNewFlowEnabled() || !isSecondPartPage()) return;

    const dialog = document.getElementById("questionStudiedDialog");
    if (dialog && !dialog.open) dialog.showModal();
  }

  function initializeQuestionStudiedDialog() {
    if (!isNewFlowEnabled() || !isSecondPartPage()) return;

    const dialog = document.getElementById("questionStudiedDialog");
    const continueButton = document.getElementById("studyAnotherQuestionButton");
    if (!dialog || !continueButton) return;

    continueButton.addEventListener("click", function () {
      dialog.close();
      const nextQuestion = document.querySelector(
        "#actionQuestionList .academic-question-study-actions button:not(:disabled)"
      );
      const focusTarget = nextQuestion || document.getElementById("questionsTitle");
      if (focusTarget) focusTarget.focus();
    });
  }

  async function handleQuestionStudied(question, button) {
    if (!question || !question.id || question.marked_studied || question.studied ||
        question.worked || button.disabled) return;

    button.disabled = true;
    button.textContent = "REGISTRANDO...";

    try {
      await service.markQuestionStudied(question.id);
      await loadPlan();
      showQuestionStudiedDialog();
    } catch (error) {
      console.error("Falha ao registrar pergunta estudada:", error);
      setStatus(
        "questionsStatus",
        error && error.message ? error.message : "Não foi possível registrar a pergunta.",
        "error"
      );
      button.disabled = false;
      button.textContent = "ESTUDEI A PERGUNTA";
    }
  }

  function questionCardNumber(question, index) {
    if (!isSecondPartPage() || !isNewFlowEnabled()) return index + 1;

    // Each number belongs to the original Conversation Questions catalog.
    // Never renumber a filtered list after a question has been studied.
    const displayOrder = Number(question && question.display_order);
    return Number.isInteger(displayOrder) && displayOrder > 0 ? displayOrder : null;
  }

  function createQuestionStudyItem(question, index, isReview) {
    const item = document.createElement("div");
    item.className = "academic-question-study-item";

    item.appendChild(window.ConversationQuestionCardRenderer.create(question, {
      number: questionCardNumber(question, index),
      className: "academic-conversation-card"
    }));

    const actions = document.createElement("div");
    actions.className = "academic-question-study-actions";

    const button = document.createElement("button");
    const questionUnavailable = !!isReview || !!question.marked_studied ||
      !!question.studied || !!question.worked;
    button.className = "academic-button " + (questionUnavailable ? "success" : "primary");
    button.type = "button";
    button.disabled = questionUnavailable;
    button.textContent = question.marked_studied
      ? "PERGUNTA ESTUDADA"
      : (question.worked
        ? "PERGUNTA JÁ TRABALHADA"
        : (isReview ? "PERGUNTA PARA REVISAR" : "ESTUDEI A PERGUNTA"));
    button.addEventListener("click", function () {
      handleQuestionStudied(question, button);
    });

    actions.appendChild(button);
    item.appendChild(actions);
    return item;
  }

  function renderReviewQuestions(questions, planQuestions) {
    const list = document.getElementById("reviewQuestionList");
    const reviews = Array.isArray(questions) ? questions : [];
    const studyByQuestionId = new Map((Array.isArray(planQuestions) ? planQuestions : [])
      .map(function (question) { return [question.id, question]; }));
    list.innerHTML = "";

    if (!reviews.length) {
      const empty = document.createElement("p");
      empty.className = "academic-empty";
      empty.textContent = "Você não tem perguntas programadas para revisão no momento.";
      list.appendChild(empty);
    } else {
      reviews.forEach(function (question, index) {
        const progress = studyByQuestionId.get(question.id) || {};
        const review = Object.assign({}, question, {
          marked_studied: progress.marked_studied === true,
          worked: true
        });
        list.appendChild(createQuestionStudyItem(review, index, true));
      });
    }

    updateQuestionCount("reviewQuestionsCount", reviews.length);
    setStatus("reviewQuestionsStatus", "", "");
  }

  function renderQuestions(plan) {
    const list = document.getElementById("actionQuestionList");
    const allQuestions = Array.isArray(plan.questions) ? plan.questions : [];
    list.innerHTML = "";

    // The permanent button-click marker is independent from "worked":
    // a teacher may have completed a question without this student clicking.
    if (allQuestions.some(function (question) {
      return typeof question.marked_studied !== "boolean";
    })) {
      setStatus("questionsStatus", "Não foi possível verificar quais perguntas ainda faltam estudar.", "error");
      return;
    }

    const questions = allQuestions.filter(function (question) {
      return !question.marked_studied;
    });

    updateQuestionCount("questionsCount", questions.length);

    if (!questions.length) {
      const item = document.createElement("p");
      item.className = "academic-empty";
      item.textContent = allQuestions.length
        ? "Você já marcou todas as perguntas como estudadas."
        : "Nenhuma pergunta disponível no momento.";
      list.appendChild(item);
      setStatus("questionsStatus", "", "");
      return;
    }

    questions.forEach(function (question, index) {
      list.appendChild(createQuestionStudyItem(question, index));
    });

    setStatus("questionsStatus", "", "");
  }

  function render(plan) {
    if (isSecondPartPage()) {
      const backLink = document.getElementById("returnToLessonLink");
      const lesson = plan && plan.lesson;
      const lessonUrl = lesson && lesson.has_material
        ? window.AcademicWorkflowService.lessonUrl(lesson.number)
        : "";

      if (backLink) {
        backLink.href = lessonUrl || "/o-que-fazer/";
        backLink.textContent = lessonUrl ? "VOLTAR À LIÇÃO" : "VOLTAR AO INÍCIO";
      }
    } else {
      renderLesson(plan);
    }
    renderQuestions(plan);
    setStatus("actionPlanStatus", "Plano atualizado.", "success");
  }

  async function loadPlan() {
    let currentPlan = null;
    try {
      currentPlan = await service.getMyActionPlan();
      render(currentPlan || {});
    } catch (error) {
      console.error("Falha ao carregar O QUE FAZER:", error);
      setStatus("actionPlanStatus", "Não foi possível carregar seu plano de preparação.", "error");
    }

    try {
      const reviews = await service.getMyReviewQuestions();
      renderReviewQuestions(reviews, currentPlan && currentPlan.questions);
    } catch (error) {
      console.error("Falha ao carregar revisões do aluno:", error);
      setStatus(
        "reviewQuestionsStatus",
        "Não foi possível carregar as revisões programadas.",
        "error"
      );
    }
  }

  async function initialize() {
    const ready = await window.ResourceWaiter.waitUntil(resourcesReady, WAIT_OPTIONS);
    if (!ready) {
      setStatus("actionPlanStatus", "Não foi possível carregar os recursos da página.", "error");
      document.body.classList.remove("auth-checking");
      return;
    }

    const session = await window.Auth.getSession();
    if (!session || !session.user) {
      redirectToLogin();
      return;
    }

    const flow = window.StudentPreparationFlow;
    if (flow && typeof flow.resolveEligibility === "function") {
      await flow.resolveEligibility(window.Auth.getClient(), session.user.id);
    }

    if (isSecondPartPage() && !isNewFlowEnabled()) {
      window.location.replace("/o-que-fazer/");
      return;
    }

    service = window.AcademicWorkflowService.create(window.Auth.getClient());
    document.body.classList.remove("auth-checking");

    if (isNewFlowEnabled() && !isSecondPartPage()) {
      showWelcome();
      trackPreparation("preparation_welcome_view");
      await loadWelcome();
      return;
    }

    if (isSecondPartPage()) {
      initializeQuestionStudiedDialog();
      trackPreparation("preparation_conversation_view");
    }
    await loadPlan();
  }

  initialize();
})();

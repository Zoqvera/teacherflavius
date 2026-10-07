(function () {
  "use strict";

  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  let service = null;

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
    window.location.href = "/login/?next=" + encodeURIComponent("/o-que-fazer/");
  }

  function lessonStatusLabel(lesson) {
    return lesson.prepared ? "ALUNO PREPARADO" : "PREVISTA";
  }

  function renderLesson(plan) {
    const container = document.getElementById("nextLessonContainer");
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

  async function handleQuestionStudied(question, button) {
    if (!question || !question.id || question.studied || question.worked || button.disabled) return;

    button.disabled = true;
    button.textContent = "REGISTRANDO...";

    try {
      await service.markQuestionStudied(question.id);
      await loadPlan();
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

  function createQuestionStudyItem(question, index) {
    const item = document.createElement("div");
    item.className = "academic-question-study-item";

    item.appendChild(window.ConversationQuestionCardRenderer.create(question, {
      number: index + 1,
      className: "academic-conversation-card"
    }));

    const actions = document.createElement("div");
    actions.className = "academic-question-study-actions";

    const button = document.createElement("button");
    const questionUnavailable = !!question.studied || !!question.worked;
    button.className = "academic-button " + (questionUnavailable ? "success" : "primary");
    button.type = "button";
    button.disabled = questionUnavailable;
    button.textContent = question.worked
      ? "PERGUNTA JÁ TRABALHADA"
      : (question.studied ? "PERGUNTA ESTUDADA" : "ESTUDEI A PERGUNTA");
    button.addEventListener("click", function () {
      handleQuestionStudied(question, button);
    });

    actions.appendChild(button);
    item.appendChild(actions);
    return item;
  }

  function renderQuestions(plan) {
    const list = document.getElementById("actionQuestionList");
    const questions = Array.isArray(plan.questions) ? plan.questions : [];
    list.innerHTML = "";

    if (!questions.length) {
      const item = document.createElement("p");
      item.className = "academic-empty";
      item.textContent = plan.questions_complete
        ? "Todas as perguntas disponíveis já foram trabalhadas."
        : "Nenhuma pergunta disponível no momento.";
      list.appendChild(item);
      setStatus("questionsStatus", "", "");
      return;
    }

    questions.forEach(function (question, index) {
      list.appendChild(createQuestionStudyItem(question, index));
    });

    const studiedCount = questions.filter(function (question) {
      return !!question.studied;
    }).length;

    setStatus(
      "questionsStatus",
      studiedCount
        ? studiedCount + " de " + questions.length + " pergunta(s) marcada(s) como estudada(s)."
        : "",
      studiedCount ? "success" : ""
    );
  }

  function render(plan) {
    renderLesson(plan);
    renderQuestions(plan);
    setStatus("actionPlanStatus", "Plano atualizado.", "success");
  }

  async function loadPlan() {
    try {
      const plan = await service.getMyActionPlan();
      render(plan || {});
    } catch (error) {
      console.error("Falha ao carregar O QUE FAZER:", error);
      setStatus("actionPlanStatus", "Não foi possível carregar seu plano de preparação.", "error");
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

    service = window.AcademicWorkflowService.create(window.Auth.getClient());

    document.body.classList.remove("auth-checking");
    await loadPlan();
  }

  initialize();
})();

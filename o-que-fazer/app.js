(function () {
  "use strict";

  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  let service = null;
  let currentPlan = null;

  function resourcesReady() {
    return !!(
      window.Auth &&
      window.ResourceWaiter &&
      window.AcademicWorkflowService &&
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

  function renderQuestions(plan) {
    const list = document.getElementById("actionQuestionList");
    const button = document.getElementById("questionsStudiedButton");
    const questions = Array.isArray(plan.questions) ? plan.questions : [];
    list.innerHTML = "";

    if (!questions.length) {
      const item = document.createElement("li");
      item.textContent = plan.questions_complete
        ? "Todas as perguntas disponíveis já foram trabalhadas."
        : "Nenhuma pergunta disponível no momento.";
      list.appendChild(item);
      button.disabled = true;
      button.textContent = plan.questions_complete
        ? "PERGUNTAS CONCLUÍDAS"
        : "ESTUDEI AS PERGUNTAS";
      setStatus("questionsStatus", "", "");
      return;
    }

    questions.forEach(function (question) {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = question.text;
      item.appendChild(text);
      list.appendChild(item);
    });

    if (plan.questions_studied) {
      button.disabled = true;
      button.textContent = "PERGUNTAS ESTUDADAS";
      setStatus(
        "questionsStatus",
        "Preparação registrada. Essas perguntas permanecem aqui até serem praticadas com o professor.",
        "success"
      );
    } else {
      button.disabled = false;
      button.textContent = "ESTUDEI AS PERGUNTAS";
      setStatus("questionsStatus", "", "");
    }
  }

  function render(plan) {
    currentPlan = plan;
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

  async function handleQuestionsStudied() {
    const button = document.getElementById("questionsStudiedButton");
    const questions = currentPlan && Array.isArray(currentPlan.questions)
      ? currentPlan.questions
      : [];

    if (!questions.length || currentPlan.questions_studied) return;

    button.disabled = true;
    button.textContent = "REGISTRANDO...";

    try {
      await service.markQuestionsStudied(questions.map(function (question) {
        return question.id;
      }));
      await loadPlan();
    } catch (error) {
      console.error("Falha ao registrar perguntas estudadas:", error);
      setStatus(
        "questionsStatus",
        error && error.message ? error.message : "Não foi possível registrar as perguntas.",
        "error"
      );
      button.disabled = false;
      button.textContent = "ESTUDEI AS PERGUNTAS";
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
    document.getElementById("questionsStudiedButton")
      .addEventListener("click", handleQuestionsStudied);

    document.body.classList.remove("auth-checking");
    await loadPlan();
  }

  initialize();
})();

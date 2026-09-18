(function () {
  "use strict";

  const RESOURCE_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 20,
    delayMs: 120
  });

  function resourcesAreReady() {
    return !!(
      window.Auth &&
      window.ResourceWaiter &&
      window.StudyLessonService &&
      window.SUPABASE_CONFIG &&
      window.Auth.isConfigured()
    );
  }

  function setStatus(message, isError) {
    const status = document.getElementById("lessonPageStatus");
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#fca5a5" : "";
  }

  function redirectToLogin() {
    const nextPath = window.location.pathname + window.location.search;
    window.location.href = "/login/?next=" + encodeURIComponent(nextPath);
  }

  function createService() {
    return window.StudyLessonService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  function renderPage(page) {
    document.getElementById("lessonDisplayNumber").textContent = page.lesson_number;
    document.getElementById("lessonPageTitle").textContent = page.title;
    document.getElementById("lessonObjective").textContent = page.objective;
    document.getElementById("lessonExample").textContent = page.example;
    document.getElementById("lessonTranslation").textContent = page.translation;
    document.getElementById("lessonPracticalExercise").textContent = page.practical_exercise;
    document.getElementById("lessonUsefulVocabulary").textContent = page.useful_vocabulary;

    document.title = page.title + " - Teacher Flávio";
    document.getElementById("lessonPageContent").hidden = false;
    setStatus("Conteúdo da lição carregado.");
  }

  async function initialize() {
    const ready = await window.ResourceWaiter.waitUntil(resourcesAreReady, RESOURCE_WAIT_OPTIONS);
    if (!ready) {
      setStatus("Não foi possível carregar os recursos da página. Atualize e tente novamente.", true);
      document.body.classList.remove("auth-checking");
      return;
    }

    const pageId = new URLSearchParams(window.location.search).get("id");
    if (!window.StudyLessonService.isValidPageId(pageId)) {
      setStatus("Página de lição inválida.", true);
      document.body.classList.remove("auth-checking");
      return;
    }

    const session = await window.Auth.getSession();
    if (!session || !session.user) {
      redirectToLogin();
      return;
    }

    try {
      const service = createService();
      const page = await service.getPage(pageId);
      if (!page) {
        setStatus("Esta página de lição não está disponível para sua conta.", true);
        document.body.classList.remove("auth-checking");
        return;
      }

      renderPage(page);
      document.body.classList.remove("auth-checking");
    } catch (error) {
      console.error("Falha ao carregar página de lição:", error);
      setStatus("Não foi possível carregar esta lição.", true);
      document.body.classList.remove("auth-checking");
    }
  }

  initialize();
})();
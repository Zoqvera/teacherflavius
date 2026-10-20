(function () {
  "use strict";

  const RESOURCE_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 20,
    delayMs: 120
  });

  let academicService = null;

  function resourcesAreReady() {
    return !!(
      window.Auth &&
      window.ResourceWaiter &&
      window.StudyLessonService &&
      window.AcademicWorkflowService &&
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

  function setPreparationStatus(message, tone) {
    const status = document.getElementById("lessonPreparationStatus");
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function bindPrintLessonAction() {
    const button = document.getElementById("printLessonButton");
    if (!button) return;

    button.addEventListener("click", function () {
      window.print();
    });
  }

  function redirectToLogin() {
    const nextPath = window.location.pathname + window.location.search;
    window.location.href = "/login/?next=" + encodeURIComponent(nextPath);
  }

  function createLessonService() {
    return window.StudyLessonService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  function isNewFlowEnabled() {
    return !!(window.StudentPreparationFlow && window.StudentPreparationFlow.enabled === true);
  }

  function trackPreparation(eventName) {
    const flow = window.StudentPreparationFlow;
    if (flow && typeof flow.track === "function") flow.track(eventName);
  }

  function isRoadmapNavigation() {
    return isNewFlowEnabled() &&
      new URLSearchParams(window.location.search).get("source") === "roteiro-de-estudos";
  }

  async function setupRoadmapNavigation(service, lessonNumber) {
    const section = document.getElementById("lessonRoadmapNavigation");
    const nextLink = document.getElementById("lessonNextLessonLink");
    const status = document.getElementById("lessonRoadmapStatus");
    if (!section || !nextLink || !status || !isRoadmapNavigation()) return;

    // The current lesson must offer PRÓXIMA PARTE, even when opened from the roadmap.
    const preparationSection = document.getElementById("lessonPreparationSection");
    if (preparationSection && !preparationSection.hidden) return;

    section.hidden = false;
    nextLink.hidden = true;
    status.textContent = "";

    if (!Number.isInteger(lessonNumber) || lessonNumber < 1) {
      status.textContent = "Esta lição não tem sequência definida no roteiro de estudos.";
      return;
    }

    const nextNumber = lessonNumber + 1;
    const legacyUrl = window.AcademicWorkflowService.legacyLessonPreviewUrl(nextNumber);

    try {
      const nextPage = await service.getLinkedPageByLessonNumber(nextNumber);
      if (nextPage) {
        nextLink.href = window.StudyLessonService.lessonPageUrl(nextPage.id) +
          "&source=roteiro-de-estudos";
      } else if (legacyUrl) {
        nextLink.href = "/licao/?lesson=" + encodeURIComponent(nextNumber) +
          "&source=roteiro-de-estudos";
      } else {
        status.textContent = "Não há uma próxima lição publicada no momento.";
        return;
      }

      nextLink.hidden = false;
      nextLink.addEventListener("click", function () {
        trackPreparation("preparation_next_lesson");
      });
    } catch (error) {
      console.error("Falha ao localizar a próxima lição:", error);
      status.textContent = "Não foi possível consultar a próxima lição. Tente novamente.";
    }
  }

  async function setupLessonPresentation(studentId, lessonNumber, pageId) {
    const editor = window.LessonPresentationEditor;
    if (!editor || editor.enabled !== true) return;
    await editor.mount({
      studentId: studentId,
      lessonNumber: lessonNumber,
      pageId: pageId,
      getClient: function () { return window.Auth.getClient(); }
    });
  }

  function showDynamicSections(visible) {
    document.querySelectorAll(".dynamic-lesson-section").forEach(function (section) {
      section.hidden = !visible;
    });
  }

  function renderDynamicPage(page) {
    document.getElementById("lessonDisplayNumber").textContent = page.lesson_number_label;
    document.getElementById("lessonPageTitle").textContent = page.title;
    document.getElementById("lessonObjective").textContent = page.objective;
    document.getElementById("lessonExample").textContent = page.example;
    document.getElementById("lessonTranslation").textContent = page.translation;
    document.getElementById("lessonPracticalExercise").textContent = page.practical_exercise;
    document.getElementById("lessonUsefulVocabulary").textContent = page.useful_vocabulary;

    showDynamicSections(true);
    document.getElementById("legacyLessonMaterial").hidden = true;
    document.title = page.title + " - Teacher Flávio";
    document.getElementById("lessonPageContent").hidden = false;
    setStatus("Conteúdo da lição carregado.");
  }

  function renderLegacyLesson(lessonNumber) {
    const previewUrl = window.AcademicWorkflowService.legacyLessonPreviewUrl(lessonNumber);
    if (!previewUrl) return false;

    showDynamicSections(false);
    document.getElementById("lessonDisplayNumber").textContent = "LIÇÃO " + lessonNumber;
    document.getElementById("lessonPageTitle").textContent = "Lição " + lessonNumber;
    document.getElementById("legacyLessonFrame").src = previewUrl;
    document.getElementById("legacyLessonMaterial").hidden = false;
    document.getElementById("lessonPageContent").hidden = false;
    document.title = "Lição " + lessonNumber + " - Teacher Flávio";
    setStatus("Material da lição carregado.");
    return true;
  }

  function disablePreparedButton(label) {
    const button = document.getElementById("lessonPreparedButton");
    button.disabled = true;
    button.textContent = label;
  }

  function bindNextPartRegistration(link, lessonNumber) {
    let registering = false;

    link.addEventListener("click", async function (event) {
      event.preventDefault();
      if (registering) return;

      registering = true;
      const previousLabel = link.textContent;
      link.setAttribute("aria-disabled", "true");
      link.textContent = "REGISTRANDO...";
      setStatus("Registrando sua preparação...");

      try {
        await academicService.markLessonPrepared(lessonNumber);
        trackPreparation("preparation_next_part");
        window.location.href = window.StudentPreparationFlow.secondPartUrl;
      } catch (error) {
        console.error("Falha ao registrar preparação:", error);
        setStatus(
          error && error.message ? error.message : "Não foi possível registrar sua preparação. Tente novamente.",
          true
        );
        link.textContent = previousLabel;
        link.removeAttribute("aria-disabled");
        registering = false;
      }
    });
  }

  async function setupPreparation(lessonNumber) {
    const section = document.getElementById("lessonPreparationSection");
    const nextPartLink = document.getElementById("lessonNextPartLink");
    const progress = document.getElementById("lessonFlowProgress");
    const currentLessonStatus = document.getElementById("lessonCurrentLessonStatus");
    const currentLessonLink = document.getElementById("lessonCurrentLessonLink");
    if (nextPartLink) nextPartLink.hidden = true;
    if (progress) progress.hidden = true;
    if (currentLessonStatus) currentLessonStatus.hidden = true;
    if (currentLessonLink) currentLessonLink.hidden = true;
    if (!lessonNumber) {
      section.hidden = true;
      return;
    }

    try {
      const plan = await academicService.getMyActionPlan();
      const currentLesson = plan && plan.lesson ? Number(plan.lesson.number) : null;
      if (currentLesson !== lessonNumber) {
        // Keep historic roadmap navigation, but never strand a student who
        // opened an outdated lesson directly or from a saved link.
        const validCurrentLesson = window.AcademicWorkflowService.normalizeLessonNumber(currentLesson);
        if (isNewFlowEnabled() && validCurrentLesson && !isRoadmapNavigation()) {
          section.hidden = false;
          const legacyContent = document.getElementById("lessonLegacyPreparationContent");
          if (legacyContent) legacyContent.hidden = true;
          if (currentLessonStatus) {
            currentLessonStatus.textContent = "Esta não é a lição prevista para sua próxima aula. Continue pela Lição " + validCurrentLesson + ".";
            currentLessonStatus.hidden = false;
          }
          if (currentLessonLink) {
            currentLessonLink.href = window.AcademicWorkflowService.lessonUrl(validCurrentLesson);
            currentLessonLink.hidden = false;
          }
        } else {
          section.hidden = true;
          if (isRoadmapNavigation()) {
            setStatus("Esta lição é do roteiro de estudos. Para continuar sua preparação atual, acesse O QUE FAZER.");
          }
        }
        return;
      }

      section.hidden = false;
      const legacyContent = document.getElementById("lessonLegacyPreparationContent");
      if (legacyContent) legacyContent.hidden = isNewFlowEnabled();
      if (isNewFlowEnabled()) {
        if (progress) progress.hidden = false;
        if (nextPartLink) {
          nextPartLink.hidden = false;
          bindNextPartRegistration(nextPartLink, lessonNumber);
        }
        trackPreparation("preparation_lesson_view");
        return;
      }
      if (plan.lesson.prepared) {
        disablePreparedButton("PREPARAÇÃO REGISTRADA");
        setPreparationStatus(
          "Sua preparação já está registrada. A conclusão será registrada pelo professor após a apresentação.",
          "success"
        );
        return;
      }

      const button = document.getElementById("lessonPreparedButton");
      button.disabled = false;
      button.textContent = "ESTOU PREPARADO";
      button.onclick = async function () {
        button.disabled = true;
        button.textContent = "REGISTRANDO...";
        try {
          await academicService.markLessonPrepared(lessonNumber);
          disablePreparedButton("PREPARAÇÃO REGISTRADA");
          setPreparationStatus(
            "Preparação registrada. O professor verá esta lição como ALUNO PREPARADO.",
            "success"
          );
        } catch (error) {
          console.error("Falha ao registrar preparação:", error);
          button.disabled = false;
          button.textContent = "ESTOU PREPARADO";
          setPreparationStatus(
            error && error.message ? error.message : "Não foi possível registrar sua preparação.",
            "error"
          );
        }
      };
    } catch (error) {
      console.error("Falha ao verificar preparação da lição:", error);
      section.hidden = true;
      setStatus("Não foi possível verificar sua lição atual. Acesse O QUE FAZER e tente novamente.", true);
    }
  }

  async function loadByLessonNumber(service, lessonNumber, studentId) {
    const linkedPage = await service.getLinkedPageByLessonNumber(lessonNumber);
    if (linkedPage) {
      renderDynamicPage(linkedPage);
      // The optional presentation editor must never block essential lesson navigation.
      void setupLessonPresentation(studentId, lessonNumber, null).catch(function (error) {
        console.error("Falha ao iniciar editor de apresentação:", error);
      });
      await setupPreparation(lessonNumber);
      await setupRoadmapNavigation(service, lessonNumber);
      return true;
    }

    if (renderLegacyLesson(lessonNumber)) {
      // The optional presentation editor must never block essential lesson navigation.
      void setupLessonPresentation(studentId, lessonNumber, null).catch(function (error) {
        console.error("Falha ao iniciar editor de apresentação:", error);
      });
      await setupPreparation(lessonNumber);
      await setupRoadmapNavigation(service, lessonNumber);
      return true;
    }

    return false;
  }

  async function loadByPageId(service, pageId, studentId) {
    if (!window.StudyLessonService.isValidPageId(pageId)) return false;
    const page = await service.getPage(pageId);
    if (!page) return false;

    renderDynamicPage(page);
    const lessonNumber = window.AcademicWorkflowService.normalizeLessonNumber(
      page.roadmap_lesson_number
    );
    // Keep the preparation controls responsive if presentation data is delayed.
    void setupLessonPresentation(studentId, lessonNumber, lessonNumber ? null : page.id)
      .catch(function (error) {
        console.error("Falha ao iniciar editor de apresentação:", error);
      });
    await setupPreparation(lessonNumber);
    await setupRoadmapNavigation(service, Number(page.roadmap_lesson_number));
    return true;
  }

  async function initialize() {
    bindPrintLessonAction();
    const ready = await window.ResourceWaiter.waitUntil(
      resourcesAreReady,
      RESOURCE_WAIT_OPTIONS
    );
    if (!ready) {
      setStatus("Não foi possível carregar os recursos da página. Atualize e tente novamente.", true);
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

    const lessonService = createLessonService();
    academicService = window.AcademicWorkflowService.create(window.Auth.getClient());
    if (isRoadmapNavigation()) trackPreparation("preparation_roadmap_view");

    const params = new URLSearchParams(window.location.search);
    const lessonNumber = window.AcademicWorkflowService.normalizeLessonNumber(
      params.get("lesson")
    );
    const pageId = params.get("id");

    try {
      let loaded = false;
      if (lessonNumber) loaded = await loadByLessonNumber(lessonService, lessonNumber, session.user.id);
      else if (pageId) loaded = await loadByPageId(lessonService, pageId, session.user.id);

      if (!loaded) {
        setStatus("Esta lição não está disponível para sua conta.", true);
      }
    } catch (error) {
      console.error("Falha ao carregar página de lição:", error);
      setStatus("Não foi possível carregar esta lição.", true);
    } finally {
      document.body.classList.remove("auth-checking");
    }
  }

  initialize();
})();

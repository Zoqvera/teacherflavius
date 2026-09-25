(function () {
  "use strict";

  const RESOURCE_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 25,
    delayMs: 120
  });

  const FIELD_CONFIG = Object.freeze([
    Object.freeze({ id: "lessonNumber", countId: "lessonNumberCount", max: 50 }),
    Object.freeze({ id: "lessonTitle", countId: "lessonTitleCount", max: 200 }),
    Object.freeze({ id: "lessonObjective", countId: "lessonObjectiveCount", max: 500 }),
    Object.freeze({ id: "lessonExample", countId: "lessonExampleCount", max: 1000 }),
    Object.freeze({ id: "lessonTranslation", countId: "lessonTranslationCount", max: 1000 }),
    Object.freeze({ id: "lessonPracticalExercise", countId: "lessonPracticalExerciseCount", max: 500 }),
    Object.freeze({ id: "lessonUsefulVocabulary", countId: "lessonUsefulVocabularyCount", max: 1000 })
  ]);

  const state = {
    session: null,
    service: null,
    pages: [],
    editingPageId: null
  };

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
    const status = document.getElementById("lessonEditorStatus");
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#fca5a5" : "";
  }

  function setListStatus(message) {
    const status = document.getElementById("lessonListStatus");
    if (status) status.textContent = message;
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

  function appendRoadmapOption(select, value, label, disabled) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    option.disabled = disabled === true;
    select.appendChild(option);
  }

  function rebuildRoadmapOptions(preferredValue) {
    const select = document.getElementById("roadmapLessonNumber");
    if (!select) return;

    const currentPage = state.pages.find(function (page) {
      return page.id === state.editingPageId;
    });
    const currentLessonNumber = currentPage ? Number(currentPage.roadmap_lesson_number) : null;
    const selectedValue = preferredValue === undefined ? select.value : String(preferredValue || "");

    const occupied = new Set(
      state.pages
        .filter(function (page) {
          return page.id !== state.editingPageId && page.roadmap_lesson_number !== null;
        })
        .map(function (page) {
          return Number(page.roadmap_lesson_number);
        })
    );

    select.replaceChildren();
    appendRoadmapOption(select, "", "Não vincular agora", false);
    appendRoadmapOption(
      select,
      window.StudyLessonService.NEW_ROADMAP_CARD_SENTINEL,
      "CRIAR NOVO CARD",
      false
    );

    for (
      let lessonNumber = 1;
      lessonNumber <= window.StudyLessonService.EXISTING_ROADMAP_CARD_COUNT;
      lessonNumber += 1
    ) {
      const isOccupied = occupied.has(lessonNumber);
      appendRoadmapOption(
        select,
        lessonNumber,
        "Lição " + lessonNumber + (isOccupied ? " — já vinculada" : ""),
        isOccupied
      );
    }

    if (currentLessonNumber > window.StudyLessonService.EXISTING_ROADMAP_CARD_COUNT) {
      appendRoadmapOption(
        select,
        currentLessonNumber,
        "Lição " + currentLessonNumber + " — card criado",
        false
      );
    }

    const hasPreferredOption = Array.from(select.options).some(function (option) {
      return option.value === selectedValue && !option.disabled;
    });
    select.value = hasPreferredOption ? selectedValue : "";
  }

  function updateCharacterCount(config) {
    const input = document.getElementById(config.id);
    const counter = document.getElementById(config.countId);
    if (!input || !counter) return;

    const length = input.value.length;
    counter.textContent = length + "/" + config.max;
    counter.classList.toggle("is-near-limit", length >= Math.floor(config.max * 0.9));
  }

  function bindCharacterCounters() {
    FIELD_CONFIG.forEach(function (config) {
      const input = document.getElementById(config.id);
      if (!input) return;
      input.addEventListener("input", function () {
        updateCharacterCount(config);
      });
      updateCharacterCount(config);
    });
  }

  function refreshCharacterCounters() {
    FIELD_CONFIG.forEach(updateCharacterCount);
  }

  function readFormPayload() {
    return {
      lesson_number_label: document.getElementById("lessonNumber").value,
      title: document.getElementById("lessonTitle").value,
      objective: document.getElementById("lessonObjective").value,
      example: document.getElementById("lessonExample").value,
      translation: document.getElementById("lessonTranslation").value,
      practical_exercise: document.getElementById("lessonPracticalExercise").value,
      useful_vocabulary: document.getElementById("lessonUsefulVocabulary").value,
      roadmap_lesson_number: document.getElementById("roadmapLessonNumber").value
    };
  }

  function setFormBusy(isBusy) {
    const saveButton = document.getElementById("saveLessonButton");
    const cancelButton = document.getElementById("cancelEditButton");
    if (saveButton) {
      saveButton.disabled = isBusy;
      saveButton.textContent = isBusy ? "SALVANDO..." : (state.editingPageId ? "SALVAR ALTERAÇÕES" : "SALVAR LIÇÃO");
    }
    if (cancelButton) cancelButton.disabled = isBusy;
  }

  function resetForm() {
    state.editingPageId = null;
    document.getElementById("lessonForm").reset();
    document.getElementById("lessonFormTitle").textContent = "Nova página de lição";
    document.getElementById("saveLessonButton").textContent = "SALVAR LIÇÃO";
    document.getElementById("cancelEditButton").hidden = true;
    rebuildRoadmapOptions("");
    refreshCharacterCounters();
  }

  function editPage(pageId) {
    const page = state.pages.find(function (candidate) {
      return candidate.id === pageId;
    });
    if (!page) return;

    state.editingPageId = page.id;
    document.getElementById("lessonNumber").value = page.lesson_number_label || "";
    document.getElementById("lessonTitle").value = page.title || "";
    document.getElementById("lessonObjective").value = page.objective || "";
    document.getElementById("lessonExample").value = page.example || "";
    document.getElementById("lessonTranslation").value = page.translation || "";
    document.getElementById("lessonPracticalExercise").value = page.practical_exercise || "";
    document.getElementById("lessonUsefulVocabulary").value = page.useful_vocabulary || "";
    rebuildRoadmapOptions(page.roadmap_lesson_number === null ? "" : page.roadmap_lesson_number);
    document.getElementById("lessonFormTitle").textContent = "Editar página de lição";
    document.getElementById("saveLessonButton").textContent = "SALVAR ALTERAÇÕES";
    document.getElementById("cancelEditButton").hidden = false;

    refreshCharacterCounters();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deletePage(pageId) {
    const page = state.pages.find(function (candidate) {
      return candidate.id === pageId;
    });
    if (!page) return;

    const linkedLessonNumber = Number(page.roadmap_lesson_number);
    let deletionEffect = " Esta página não está conectada ao Roteiro de Estudos.";
    if (linkedLessonNumber > window.StudyLessonService.EXISTING_ROADMAP_CARD_COUNT) {
      deletionEffect = " O card criado para esta lição também será removido do Roteiro de Estudos.";
    } else if (linkedLessonNumber >= 1) {
      deletionEffect = " O card original voltará ao destino anterior quando houver PDF cadastrado.";
    }
    const confirmed = window.confirm(
      "Excluir a página \"" + page.title + "\"?" + deletionEffect
    );
    if (!confirmed) return;

    try {
      setStatus("Excluindo página de lição...");
      await state.service.deletePage(pageId);
      if (state.editingPageId === pageId) resetForm();
      await loadPages();
      setStatus("Página de lição excluída.");
    } catch (error) {
      setStatus("Não foi possível excluir a página: " + (error.message || "erro desconhecido") + ".", true);
    }
  }

  function createActionButton(label, className, action, pageId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.pageId = pageId;
    return button;
  }

  function renderPages() {
    const list = document.getElementById("lessonPagesList");
    if (!list) return;
    list.replaceChildren();

    if (!state.pages.length) {
      setListStatus("Nenhuma página de lição foi criada ainda.");
      return;
    }

    setListStatus(state.pages.length + (state.pages.length === 1 ? " página criada." : " páginas criadas."));

    state.pages.forEach(function (page) {
      const card = document.createElement("article");
      card.className = "lesson-management-card";

      const title = document.createElement("h3");
      title.textContent = page.title;

      const meta = document.createElement("p");
      meta.className = "lesson-management-meta" + (page.roadmap_lesson_number ? " is-linked" : "");
      meta.textContent = page.roadmap_lesson_number
        ? "Conectada à Lição " + page.roadmap_lesson_number
        : "Sem vínculo com o Roteiro de Estudos";

      const actions = document.createElement("div");
      actions.className = "lesson-management-actions";

      const preview = document.createElement("a");
      preview.className = "preview-link";
      preview.href = window.StudyLessonService.lessonPageUrl(page.id);
      preview.target = "_blank";
      preview.rel = "noopener noreferrer";
      preview.textContent = "ABRIR PRÉVIA";

      actions.appendChild(createActionButton("EDITAR", "secondary-button", "edit", page.id));
      actions.appendChild(preview);
      actions.appendChild(createActionButton("EXCLUIR", "danger-button", "delete", page.id));

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  async function loadPages() {
    state.pages = await state.service.listAllPages();
    rebuildRoadmapOptions();
    renderPages();
  }

  async function saveLesson(event) {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setFormBusy(true);
    setStatus(state.editingPageId ? "Salvando alterações..." : "Criando página de lição...");

    try {
      const payload = readFormPayload();
      const requestedNewCard = Number(payload.roadmap_lesson_number) === window.StudyLessonService.NEW_ROADMAP_CARD_SENTINEL;
      let savedPage;

      if (state.editingPageId) {
        savedPage = await state.service.updatePage(state.editingPageId, payload);
      } else {
        savedPage = await state.service.createPage(payload);
      }

      const successMessage = requestedNewCard
        ? "Página salva e Lição " + savedPage.roadmap_lesson_number + " criada no Roteiro de Estudos."
        : (state.editingPageId ? "Página de lição atualizada." : "Página de lição criada.");
      await loadPages();
      resetForm();
      setStatus(successMessage);
    } catch (error) {
      setStatus("Não foi possível salvar a lição: " + (error.message || "erro desconhecido") + ".", true);
    } finally {
      setFormBusy(false);
    }
  }

  function bindEvents() {
    document.getElementById("lessonForm").addEventListener("submit", saveLesson);
    document.getElementById("cancelEditButton").addEventListener("click", resetForm);

    document.getElementById("lessonPagesList").addEventListener("click", function (event) {
      const button = event.target.closest("button[data-action][data-page-id]");
      if (!button) return;

      if (button.dataset.action === "edit") editPage(button.dataset.pageId);
      if (button.dataset.action === "delete") deletePage(button.dataset.pageId);
    });

    bindCharacterCounters();
  }

  async function initialize() {
    const ready = await window.ResourceWaiter.waitUntil(resourcesAreReady, RESOURCE_WAIT_OPTIONS);
    if (!ready) {
      setStatus("Não foi possível carregar os recursos de autenticação. Atualize a página.", true);
      document.body.classList.remove("auth-checking");
      return;
    }

    state.session = await window.Auth.getSession();
    if (!state.session || !state.session.user) {
      redirectToLogin();
      return;
    }

    try {
      const client = window.Auth.getClient();
      const adminResponse = await client.rpc("is_teacher_admin");
      if (adminResponse.error) throw adminResponse.error;
      if (adminResponse.data !== true) {
        setStatus("Acesso negado. Esta página é exclusiva do professor.", true);
        document.body.classList.remove("auth-checking");
        return;
      }

      state.service = createService();
      rebuildRoadmapOptions("");
      bindEvents();
      await loadPages();

      document.getElementById("lessonEditorContent").hidden = false;
      document.body.classList.remove("auth-checking");
      setStatus("Professor autenticado. Você pode criar e conectar páginas de lição.");
    } catch (error) {
      console.error("Falha ao inicializar o editor de lições:", error);
      setStatus("Não foi possível confirmar as credenciais administrativas ou carregar as lições.", true);
      document.body.classList.remove("auth-checking");
    }
  }

  initialize();
})();
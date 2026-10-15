(function () {
  "use strict";

  const PROFESSOR_EMAIL = "flaviofreitas@ufu.br";
  const AUTH_RESOURCE_MAX_ATTEMPTS = 10;
  const AUTH_RESOURCE_RETRY_DELAY_MS = 150;
  const STUDENT_AREA_PATH = "/area-do-estudante/";
  const STUDENT_RESOURCES_PATH = "/area-do-estudante/recursos/";
  const LOGIN_PATH = "/login/";

  const state = {
    session: null,
    isProfessor: false
  };

  function redirectToLogin() {
    const next = encodeURIComponent(STUDENT_AREA_PATH);
    window.location.href = LOGIN_PATH + "?next=" + next;
  }

  function authResourcesAreReady() {
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
  }

  function waitForAuthResources() {
    return window.ResourceWaiter.waitUntil(authResourcesAreReady, {
      maxAttempts: AUTH_RESOURCE_MAX_ATTEMPTS,
      delayMs: AUTH_RESOURCE_RETRY_DELAY_MS
    });
  }

  function getLoggedEmail() {
    const user = state.session && state.session.user;
    return user && user.email ? String(user.email).trim().toLowerCase() : "";
  }

  function isProfessorSession() {
    return state.isProfessor || getLoggedEmail() === PROFESSOR_EMAIL;
  }

  async function detectProfessorSession() {
    state.isProfessor = getLoggedEmail() === PROFESSOR_EMAIL;

    try {
      const response = await Auth.getClient().rpc("is_teacher_admin");
      if (!response.error && response.data === true) state.isProfessor = true;
    } catch (error) {
      console.warn("Não foi possível confirmar credenciais de professor no banco:", error);
    }

    return state.isProfessor;
  }

  function updateProfessorAreaVisibility() {
    const professorSection = document.getElementById("professorAreaSection");
    if (professorSection) professorSection.hidden = !isProfessorSession();
  }

  function createStudentResourcesCard() {
    const card = document.createElement("a");
    card.className = "menu-button";
    card.href = STUDENT_RESOURCES_PATH;
    card.dataset.studentResourcesCard = "true";

    const label = document.createElement("span");
    label.className = "menu-label";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg class="tf-icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>';

    label.appendChild(icon);
    label.appendChild(document.createTextNode("RECURSOS"));

    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    card.appendChild(label);
    card.appendChild(arrow);
    return card;
  }

  function ensureStudentResourcesCard() {
    if (document.querySelector('[data-student-resources-card="true"]')) return;

    const studySection = document.querySelector('[aria-labelledby="studyTitle"]');
    const studyGrid = studySection ? studySection.querySelector(".menu-grid") : null;
    if (!studyGrid) return;

    studyGrid.appendChild(createStudentResourcesCard());
  }

  function showAuthLoadError(status) {
    document.body.classList.remove("auth-checking");
    if (!status) return;
    status.hidden = false;
    status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.";
  }

  async function guardStudentArea() {
    const status = document.getElementById("loginStatus");
    const resourcesReady = await waitForAuthResources();

    if (!resourcesReady) {
      showAuthLoadError(status);
      return false;
    }

    state.session = await Auth.getSession();

    if (!state.session || !state.session.user) {
      redirectToLogin();
      return false;
    }

    await detectProfessorSession();
    updateProfessorAreaVisibility();

    document.body.classList.remove("auth-checking");
    return true;
  }

  function clearLoginStatus() {
    const status = document.getElementById("loginStatus");
    if (!status) return;
    status.textContent = "";
    status.hidden = true;
  }

  function initializePwaInstallExperience() {
    const installPrompt = window.TeacherFlaviusPwaInstallPrompt;
    if (!installPrompt || typeof installPrompt.initialize !== "function") return;
    installPrompt.initialize(window, document);
  }

  async function initializeReviewInvitation() {
    const invitation = window.StudentReviewInvitation;
    if (!invitation || typeof invitation.initialize !== "function") return;

    await invitation.initialize({
      client: Auth.getClient(),
      studentId: state.session.user.id,
      isProfessor: isProfessorSession()
    });
  }

  async function updateStatus() {
    const isAllowed = await guardStudentArea();
    if (!isAllowed) return;

    clearLoginStatus();
    initializePwaInstallExperience();
    await initializeReviewInvitation();
  }

  ensureStudentResourcesCard();
  updateStatus();
})();

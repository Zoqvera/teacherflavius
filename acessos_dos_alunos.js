(function () {
  "use strict";

  const RESOURCE_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 15,
    delayMs: 150
  });
  const state = {
    session: null,
    accessService: null,
    renderer: null
  };

  function resourcesAreReady() {
    return !!(
      window.Auth &&
      window.StudentAccessService &&
      window.StudentAccessRenderer &&
      window.SUPABASE_CONFIG &&
      window.Auth.isConfigured()
    );
  }

  function createAccessService() {
    return window.StudentAccessService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  async function loadStudents() {
    const students = await state.accessService.getStudents();
    state.renderer.renderStudents(students);
  }

  async function loadAccessStatuses() {
    const statuses = await state.accessService.getAccessStatuses();
    state.renderer.renderAccessStatuses(statuses);
  }

  async function loadAccesses() {
    const filters = state.renderer.getAccessFilters();
    state.renderer.showAccessLoading();

    try {
      const accesses = await state.accessService.getAccesses(filters);
      state.renderer.renderAccesses(accesses);
      state.renderer.setStatus("Professor autenticado: " + state.session.user.email + ".");
    } catch (error) {
      state.renderer.showAccessError(
        "Não foi possível carregar os acessos. Detalhe: " + (error.message || "erro desconhecido")
      );
      state.renderer.setStatus("O painel ainda não está configurado corretamente no Supabase.", true);
    } finally {
      state.renderer.setRefreshDisabled(false);
    }
  }

  async function refreshDashboard() {
    await Promise.all([loadAccessStatuses(), loadAccesses()]);
  }

  function redirectToLogin() {
    const nextPath = window.Auth.normalizeNextPath(window.location.pathname, "/professor/");
    window.location.href = "/login/?next=" + encodeURIComponent(nextPath);
  }

  function bindDashboardEvents() {
    state.renderer.bindEvents({
      onRefresh: refreshDashboard,
      onStudentChange: loadAccesses,
      onPeriodChange: loadAccesses
    });
  }

  function showInitializationError(error) {
    state.renderer.setStatus(
      "Não foi possível confirmar as credenciais administrativas ou carregar os dados.",
      true
    );
    state.renderer.finishAuthCheck();
    state.renderer.showStatusError(
      error.message || "Não foi possível carregar a situação dos alunos."
    );
  }

  async function initializeDashboard() {
    const ready = await window.ResourceWaiter.waitUntil(resourcesAreReady, RESOURCE_WAIT_OPTIONS);

    if (!ready) {
      const status = document.getElementById("accessStatus");
      if (status) {
        status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache.";
        status.style.color = "#fca5a5";
      }
      document.body.classList.remove("auth-checking");
      return;
    }

    state.renderer = window.StudentAccessRenderer.create();
    state.accessService = createAccessService();
    bindDashboardEvents();

    state.session = await window.Auth.getSession();
    if (!state.session || !state.session.user) {
      redirectToLogin();
      return;
    }

    try {
      const isTeacherAdmin = await state.accessService.isTeacherAdmin();
      if (!isTeacherAdmin) {
        state.renderer.setStatus("Acesso negado. Esta página é exclusiva do professor.", true);
        state.renderer.finishAuthCheck();
        return;
      }

      state.renderer.showDashboard();
      state.renderer.finishAuthCheck();
      state.renderer.setStatus("Professor autenticado: " + state.session.user.email + ".");

      await loadStudents();
      await refreshDashboard();
    } catch (error) {
      showInitializationError(error);
    }
  }

  initializeDashboard();
})();

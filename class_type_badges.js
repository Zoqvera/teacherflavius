(function () {
  "use strict";

  const CLASS_TYPE_RETRY_DELAY_MS = 250;

  let classTypeCache = null;
  let classTypeLoading = false;
  let classTypeWaitPending = false;
  let classTypeService = null;

  function dependenciesReady() {
    return !!(
      window.Auth &&
      window.SUPABASE_CONFIG &&
      window.Auth.isConfigured()
    );
  }

  function requireRenderer() {
    const renderer = window.ClassTypeBadgeRenderer;
    if (!renderer) throw new Error("O renderer de etiquetas de turma não está disponível.");
    return renderer;
  }

  function createService() {
    if (!window.ClassTypeService || typeof window.ClassTypeService.create !== "function") {
      throw new Error("O serviço de tipos de turma não está disponível.");
    }

    return window.ClassTypeService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  function getService() {
    if (!classTypeService) classTypeService = createService();
    return classTypeService;
  }

  function render() {
    requireRenderer().render(classTypeCache);
  }

  async function waitForDependencies() {
    const waiter = window.ResourceWaiter;
    if (waiter && typeof waiter.waitUntil === "function") {
      return waiter.waitUntil(dependenciesReady, {
        maxAttempts: null,
        delayMs: CLASS_TYPE_RETRY_DELAY_MS
      });
    }

    await new Promise(function (resolve) {
      window.setTimeout(resolve, CLASS_TYPE_RETRY_DELAY_MS);
    });
    return dependenciesReady();
  }

  async function waitAndLoad() {
    if (classTypeWaitPending) return;

    classTypeWaitPending = true;
    let ready = false;

    try {
      ready = await waitForDependencies();
      if (ready) {
        await load();
        return;
      }
    } finally {
      classTypeWaitPending = false;
    }

    load();
  }

  async function load() {
    const renderer = requireRenderer();
    if (!renderer.isClassBoardPage() || classTypeCache || classTypeLoading) {
      render();
      return;
    }

    if (!dependenciesReady()) {
      await waitAndLoad();
      return;
    }

    classTypeLoading = true;
    try {
      const rows = await getService().getClassTypes();
      classTypeCache = new Map(rows.map(function (row) {
        return [Number(row.class_number), row];
      }));
      render();
    } catch (error) {
      console.error("Não foi possível carregar etiquetas das turmas:", error);
    } finally {
      classTypeLoading = false;
    }
  }

  function initialize() {
    load();
  }

  function refresh() {
    if (classTypeCache) {
      render();
      return;
    }
    load();
  }

  window.ClassTypeBadges = Object.freeze({
    initialize: initialize,
    refresh: refresh
  });
})();

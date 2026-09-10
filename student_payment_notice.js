(function () {
  "use strict";

  const SCRIPT_LOAD_TIMEOUT_MS = 6000;
  const FEATURE_MODULES = Object.freeze([
    Object.freeze({
      globalName: "StudentPaymentService",
      selector: 'script[src^="/student_payment_service.js"]',
      src: "/student_payment_service.js?v=20260902-1"
    }),
    Object.freeze({
      globalName: "StudentPaymentNoticePresenter",
      selector: 'script[src^="/student_payment_notice_presenter.js"]',
      src: "/student_payment_notice_presenter.js?v=20260902-1"
    }),
    Object.freeze({
      globalName: "StudentPaymentNoticeRenderer",
      selector: 'script[src^="/student_payment_notice_renderer.js"]',
      src: "/student_payment_notice_renderer.js?v=20260902-1"
    })
  ]);

  function loadScript(selector, src, isReady) {
    const waiter = window.ResourceWaiter;
    if (!waiter || typeof waiter.loadScript !== "function") return Promise.resolve(false);

    return waiter.loadScript({
      selector: selector,
      src: src,
      isReady: isReady,
      timeoutMs: SCRIPT_LOAD_TIMEOUT_MS
    });
  }

  function loadFeatureModule(config) {
    return loadScript(config.selector, config.src, function () {
      return !!window[config.globalName];
    });
  }

  async function ensureFeatureModules() {
    const results = await Promise.all(FEATURE_MODULES.map(loadFeatureModule));
    return results.every(Boolean);
  }

  async function ensureAuthentication() {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured && Auth.isConfigured()) return true;

    const supabaseReady = await loadScript(
      'script[src*="@supabase/supabase-js"]',
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
      function () { return !!(window.supabase && window.supabase.createClient); }
    );
    if (!supabaseReady) return false;

    const configReady = await loadScript(
      'script[src*="supabase_config.js"]',
      "/supabase_config.js?v=20260820-tuition-warning-1",
      function () { return !!window.SUPABASE_CONFIG; }
    );
    if (!configReady) return false;

    const authReady = await loadScript(
      'script[src*="auth.js"]',
      "/auth.js?v=20260820-tuition-warning-1",
      function () { return !!(window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured); }
    );

    return !!(authReady && Auth.isConfigured && Auth.isConfigured());
  }

  function createPaymentService() {
    return window.StudentPaymentService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  function getPresenter() {
    return window.StudentPaymentNoticePresenter;
  }

  function getRenderer() {
    return window.StudentPaymentNoticeRenderer;
  }

  async function reconcileIfNeeded(service, presenter, tuitions) {
    if (!presenter.hasPaymentWaiting(tuitions)) return tuitions;

    try {
      const reconciled = await service.reconcilePendingPayments();
      return reconciled ? service.getPendingTuitions() : tuitions;
    } catch (reconciliationError) {
      console.warn(
        "Não foi possível reconciliar o pagamento pendente:",
        reconciliationError && reconciliationError.message
          ? reconciliationError.message
          : reconciliationError
      );
      return tuitions;
    }
  }

  function renderNotice(renderer, notice, session) {
    if (!notice) return;

    renderer.installStyles();
    renderer.showBanner(notice.summary, notice.tone);
    if (notice.modalTuition) {
      renderer.showOverdueModal(notice.summary, session, notice.modalTuition);
    }
  }

  async function initializePaymentNotice() {
    if (!(await ensureFeatureModules())) return;
    if (!(await ensureAuthentication())) return;

    let session;
    try {
      session = await Auth.getSession();
    } catch (_error) {
      return;
    }
    if (!session || !session.user) return;

    try {
      const service = createPaymentService();
      const presenter = getPresenter();
      const renderer = getRenderer();
      let tuitions = await service.getPendingTuitions();
      tuitions = await reconcileIfNeeded(service, presenter, tuitions);
      renderNotice(renderer, presenter.createNotice(tuitions), session);
    } catch (error) {
      console.warn(
        "Não foi possível verificar mensalidades pendentes:",
        error && error.message ? error.message : error
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePaymentNotice, { once: true });
  } else {
    initializePaymentNotice();
  }
})();

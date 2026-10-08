(function () {
  "use strict";

  const LOAD_TIMEOUT_MS = 7000;
  const AUTH_ASSETS = Object.freeze([
    Object.freeze({
      selector: 'script[src*="@supabase/supabase-js"]',
      src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3",
      ready: function () { return !!(window.supabase && window.supabase.createClient); }
    }),
    Object.freeze({
      selector: 'script[src*="supabase_config.js"]',
      src: "/supabase_config.js?v=20260820-tuition-warning-1",
      ready: function () { return !!window.SUPABASE_CONFIG; }
    }),
    Object.freeze({
      selector: 'script[src*="supabase_client_service.js"]',
      src: "/supabase_client_service.js?v=20260902-1",
      ready: function () { return !!window.SupabaseClientService; }
    }),
    Object.freeze({
      selector: 'script[src*="auth_navigation_service.js"]',
      src: "/auth_navigation_service.js?v=20260902-1",
      ready: function () { return !!window.AuthNavigationService; }
    }),
    Object.freeze({
      selector: 'script[src*="student_data_utils.js"]',
      src: "/student_data_utils.js?v=20261008-titlecase-2",
      ready: function () { return !!window.StudentDataUtils; }
    }),
    Object.freeze({
      selector: 'script[src*="student_enrollment_service.js"]',
      src: "/student_enrollment_service.js?v=20261008-titlecase-2",
      ready: function () { return !!window.StudentEnrollmentService; }
    }),
    Object.freeze({
      selector: 'script[src*="module_loader.js"]',
      src: "/module_loader.js?v=20260902-2",
      ready: function () { return !!window.ModuleLoader; }
    }),
    Object.freeze({
      selector: 'script[src*="auth.js"]',
      src: "/auth.js?v=20260430-3",
      ready: function () { return !!(window.Auth && Auth.getClient && Auth.getSession); }
    })
  ]);
  const FEATURE_ASSETS = Object.freeze([
    Object.freeze({
      selector: 'script[src^="/student_policy_notice_service.js"]',
      src: "/student_policy_notice_service.js?v=20261005-1",
      ready: function () { return !!window.StudentPolicyNoticeService; }
    }),
    Object.freeze({
      selector: 'script[src^="/student_policy_notice_renderer.js"]',
      src: "/student_policy_notice_renderer.js?v=20261005-1",
      ready: function () { return !!window.StudentPolicyNoticeRenderer; }
    })
  ]);

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitUntilReady(isReady) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOAD_TIMEOUT_MS) {
      if (isReady()) return true;
      await wait(50);
    }
    return isReady();
  }

  async function loadAsset(asset) {
    if (asset.ready()) return true;

    if (!document.querySelector(asset.selector)) {
      const script = document.createElement("script");
      script.src = asset.src;
      script.async = false;
      document.head.appendChild(script);
    }

    return waitUntilReady(asset.ready);
  }

  async function ensureAssets(assets) {
    for (const asset of assets) {
      if (!(await loadAsset(asset))) return false;
    }
    return true;
  }

  function authReady() {
    return !!(
      window.Auth &&
      window.SUPABASE_CONFIG &&
      Auth.getClient &&
      Auth.getSession &&
      Auth.isConfigured &&
      Auth.isConfigured()
    );
  }

  async function ensureAuthentication() {
    if (authReady()) return true;
    if (!(await ensureAssets(AUTH_ASSETS))) return false;
    return authReady();
  }

  function createService() {
    return window.StudentPolicyNoticeService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  async function initialize() {
    if (!(await ensureAssets(FEATURE_ASSETS))) return;
    if (!(await ensureAuthentication())) return;

    let session;
    try {
      session = await Auth.getSession();
    } catch (_error) {
      return;
    }
    if (!session || !session.user) return;

    const service = createService();
    let notice;

    try {
      notice = await service.getRequiredNotice();
    } catch (error) {
      console.warn(
        "Não foi possível verificar o comunicado obrigatório:",
        error && error.message ? error.message : error
      );
      return;
    }

    if (!notice || notice.required !== true) return;

    window.StudentPolicyNoticeRenderer.show(async function () {
      await service.acceptNotice(notice.policy_version);
      window.StudentPolicyNoticeRenderer.dismiss();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

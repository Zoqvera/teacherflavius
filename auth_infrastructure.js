(function () {
  "use strict";

  const PATHS = Object.freeze({
    login: "/login/",
    profile: "/perfil/",
    studentArea: "/area-do-estudante/"
  });

  const ASSETS = Object.freeze({
    animatedCardsCss: "animated_cards.css?v=20260429-6",
    animatedCardsJs: "animated_cards.js?v=20260902-3",
    accessTrackerJs: "/student_access_tracker.js?v=20260730-2",
    googleAuthCss: "/google_auth_ui.css?v=20260902-1",
    googleAuthJs: "/google_auth_ui.js?v=20260902-1",
    passwordRecoveryCss: "/password_recovery_login.css?v=20260909-1",
    passwordRecoveryJs: "/password_recovery_login.js?v=20260912-1",
    studentAreaGuardJs: "/student_area_route_guard.js?v=20260909-1",
    accountSecurityJs: "/account_security_ui.js?v=20260912-1",
    infrastructureCss: "/auth_infrastructure.css?v=20260902-1"
  });

  const RESOURCE_WAITER_MODULE = Object.freeze({
    globalName: "ResourceWaiter",
    selector: 'script[src^="/resource_waiter.js"]',
    src: "/resource_waiter.js?v=20260902-1",
    missingMessage: "O helper de espera de recursos não foi inicializado.",
    loadErrorMessage: "Não foi possível carregar o helper de espera de recursos."
  });

  function runWhenDomReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  function appendStylesheetOnce(selector, href) {
    if (document.querySelector(selector)) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function appendScriptOnce(selector, src) {
    if (document.querySelector(selector)) return;

    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  function loadResourceWaiter() {
    const moduleLoader = window.ModuleLoader;
    if (!moduleLoader || typeof moduleLoader.loadGlobalModule !== "function") {
      return Promise.reject(new Error("O carregador de módulos não está disponível para o rastreamento de acesso."));
    }
    return moduleLoader.loadGlobalModule(RESOURCE_WAITER_MODULE);
  }

  function loadAnimatedCards() {
    loadResourceWaiter()
      .then(function () {
        appendScriptOnce('script[src^="animated_cards.js"]', ASSETS.animatedCardsJs);
      })
      .catch(function (error) {
        console.warn("Não foi possível preparar o helper de recursos para os assets compartilhados:", error);
        appendScriptOnce('script[src^="animated_cards.js"]', ASSETS.animatedCardsJs);
      });
  }

  function loadAccessTracker() {
    loadResourceWaiter()
      .then(function () {
        appendScriptOnce('script[src^="/student_access_tracker.js"]', ASSETS.accessTrackerJs);
      })
      .catch(function (error) {
        console.warn("Não foi possível inicializar o rastreamento de acesso:", error);
      });
  }

  function loadSharedAssets() {
    runWhenDomReady(function () {
      appendStylesheetOnce('link[href^="animated_cards.css"]', ASSETS.animatedCardsCss);
      loadAnimatedCards();
      loadAccessTracker();
    });
  }

  function isGoogleAuthUiPage(pathname) {
    return pathname === PATHS.login || pathname === PATHS.profile;
  }

  function loadLoginPasswordRecoveryAssets(pathname) {
    if (pathname !== PATHS.login) return;

    appendStylesheetOnce('link[href^="/password_recovery_login.css"]', ASSETS.passwordRecoveryCss);
    runWhenDomReady(function () {
      appendScriptOnce('script[src^="/password_recovery_login.js"]', ASSETS.passwordRecoveryJs);
    });
  }

  function loadStudentAreaGuard(pathname) {
    if (pathname !== PATHS.studentArea) return;

    runWhenDomReady(function () {
      appendScriptOnce('script[src^="/student_area_route_guard.js"]', ASSETS.studentAreaGuardJs);
    });
  }

  function loadAccountSecurity(pathname) {
    if (pathname !== PATHS.profile) return;

    runWhenDomReady(function () {
      appendScriptOnce('script[src^="/account_security_ui.js"]', ASSETS.accountSecurityJs);
    });
  }

  function loadGoogleAuthUiAssets(pathname) {
    if (!isGoogleAuthUiPage(pathname)) return;

    appendStylesheetOnce('link[href^="/google_auth_ui.css"]', ASSETS.googleAuthCss);
    runWhenDomReady(function () {
      appendScriptOnce('script[src^="/google_auth_ui.js"]', ASSETS.googleAuthJs);
    });
  }

  function showConfigWarning() {
    appendStylesheetOnce('link[href^="/auth_infrastructure.css"]', ASSETS.infrastructureCss);

    runWhenDomReady(function () {
      if (document.getElementById("supabase-config-warning")) return;

      const warning = document.createElement("div");
      warning.id = "supabase-config-warning";
      warning.className = "supabase-config-warning";
      warning.setAttribute("role", "status");
      warning.textContent = "Supabase ainda não configurado. Edite supabase_config.js com a URL e a chave pública anon do seu projeto.";
      document.body.appendChild(warning);
    });
  }

  function initialize(options) {
    const settings = options || {};
    const pathname = settings.pathname || window.location.pathname;
    loadSharedAssets();
    loadGoogleAuthUiAssets(pathname);
    loadLoginPasswordRecoveryAssets(pathname);
    loadStudentAreaGuard(pathname);
    loadAccountSecurity(pathname);
  }

  window.AuthInfrastructure = Object.freeze({
    initialize: initialize,
    showConfigWarning: showConfigWarning
  });
})();

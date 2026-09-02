(function () {
  "use strict";

  const PATHS = Object.freeze({
    login: "/login/",
    profile: "/perfil/"
  });

  const ASSETS = Object.freeze({
    animatedCardsCss: "animated_cards.css?v=20260429-6",
    animatedCardsJs: "animated_cards.js?v=20260716-logout-1",
    accessTrackerJs: "/student_access_tracker.js?v=20260730-2",
    googleAuthCss: "/google_auth_ui.css?v=20260902-1",
    googleAuthJs: "/google_auth_ui.js?v=20260902-1",
    infrastructureCss: "/auth_infrastructure.css?v=20260902-1"
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

  function loadSharedAssets() {
    runWhenDomReady(function () {
      appendStylesheetOnce('link[href^="animated_cards.css"]', ASSETS.animatedCardsCss);
      appendScriptOnce('script[src^="animated_cards.js"]', ASSETS.animatedCardsJs);
      appendScriptOnce('script[src^="/student_access_tracker.js"]', ASSETS.accessTrackerJs);
    });
  }

  function isGoogleAuthUiPage(pathname) {
    return pathname === PATHS.login || pathname === PATHS.profile;
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
    loadSharedAssets();
    loadGoogleAuthUiAssets(settings.pathname || window.location.pathname);
  }

  window.AuthInfrastructure = Object.freeze({
    initialize: initialize,
    showConfigWarning: showConfigWarning
  });
})();
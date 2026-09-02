(function () {
  "use strict";

  const RECORDED_LESSONS_SCRIPT = Object.freeze({
    selector: 'script[src^="class_recorded_lessons.js"]',
    src: "class_recorded_lessons.js?v=20260429-1"
  });

  const GLOBAL_LOGOUT_SCRIPT = Object.freeze({
    selector: 'script[src^="/global_logout.js"], script[src^="global_logout.js"]',
    src: "/global_logout.js?v=20260716-1"
  });

  const FEATURE_MODULES = Object.freeze([
    Object.freeze({
      globalName: "AnimatedCardsVisuals",
      selector: 'script[src^="/animated_cards_visuals.js"]',
      src: "/animated_cards_visuals.js?v=20260902-1",
      missingMessage: "O módulo visual dos cards não foi inicializado.",
      loadErrorMessage: "Não foi possível carregar o módulo visual dos cards."
    }),
    Object.freeze({
      globalName: "ClassTypeBadges",
      selector: 'script[src^="/class_type_badges.js"]',
      src: "/class_type_badges.js?v=20260902-1",
      missingMessage: "O módulo de etiquetas de turma não foi inicializado.",
      loadErrorMessage: "Não foi possível carregar o módulo de etiquetas de turma."
    })
  ]);

  function appendScriptOnce(config) {
    if (document.querySelector(config.selector)) return;

    const script = document.createElement("script");
    script.src = config.src;
    script.defer = true;
    document.body.appendChild(script);
  }

  function loadSharedExtensions() {
    appendScriptOnce(RECORDED_LESSONS_SCRIPT);
    if (!window.teacherFlavioGlobalLogoutLoaded) {
      appendScriptOnce(GLOBAL_LOGOUT_SCRIPT);
    }
  }

  function loadFeatureModules() {
    const moduleLoader = window.ModuleLoader;
    if (!moduleLoader || typeof moduleLoader.loadGlobalModule !== "function") {
      return Promise.reject(new Error("O carregador de módulos não está disponível para os cards animados."));
    }

    return Promise.all(FEATURE_MODULES.map(function (config) {
      return moduleLoader.loadGlobalModule(config);
    }));
  }

  function initializeModule(globalName) {
    const module = window[globalName];
    if (module && typeof module.initialize === "function") {
      module.initialize();
    }
  }

  function refreshModule(globalName) {
    const module = window[globalName];
    if (module && typeof module.refresh === "function") {
      module.refresh();
    }
  }

  function initializeFeatures() {
    initializeModule("AnimatedCardsVisuals");
    initializeModule("ClassTypeBadges");
  }

  function refreshFeatures() {
    refreshModule("AnimatedCardsVisuals");
    refreshModule("ClassTypeBadges");
  }

  function observeDynamicContent() {
    const observer = new MutationObserver(refreshFeatures);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function initialize() {
    loadSharedExtensions();

    try {
      await loadFeatureModules();
    } catch (error) {
      console.warn("Não foi possível carregar todos os módulos dos cards animados:", error);
    }

    initializeFeatures();
    observeDynamicContent();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

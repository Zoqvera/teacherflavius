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

  function initialize() {
    loadSharedExtensions();
    initializeFeatures();
    observeDynamicContent();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

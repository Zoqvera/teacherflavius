(function () {
  "use strict";

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  function safeStorageGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function safeStorageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (_error) {
      // Storage can be unavailable.
    }
  }

  function cleanText(value, maxLength) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return text.slice(0, maxLength || 100);
  }

  function currentPath() {
    return window.location.pathname || "/";
  }

  function classifyArea(path) {
    const normalizedPath = String(path || "/").toLowerCase();
    const legacyIndexPath = "/index" + ".html";

    if (
      normalizedPath === "/" ||
      normalizedPath === legacyIndexPath ||
      normalizedPath.indexOf("/quero-conhecer") === 0 ||
      normalizedPath.indexOf("/quero_conhecer") === 0 ||
      normalizedPath.indexOf("/landing-page") === 0
    ) {
      return "marketing";
    }

    if (
      normalizedPath.indexOf("/complete-cadastro") === 0 ||
      normalizedPath.indexOf("/cadastro") === 0 ||
      normalizedPath.indexOf("/login") === 0
    ) {
      return "enrollment";
    }

    if (
      normalizedPath.indexOf("/pagamento") === 0 ||
      normalizedPath.indexOf("/mensalidades") === 0
    ) {
      return "payment";
    }

    if (
      normalizedPath.indexOf("/professor") === 0 ||
      normalizedPath.indexOf("/perfil-dos-alunos") === 0 ||
      normalizedPath.indexOf("/editar-aluno") === 0 ||
      normalizedPath.indexOf("/relatorios") === 0 ||
      normalizedPath.indexOf("/radar-de-alunos") === 0 ||
      normalizedPath.indexOf("/turmas") === 0
    ) {
      return "admin";
    }

    return "student_portal";
  }

  window.TeacherAnalyticsUtils = Object.freeze({
    safeJsonParse: safeJsonParse,
    safeStorageGet: safeStorageGet,
    safeStorageSet: safeStorageSet,
    cleanText: cleanText,
    currentPath: currentPath,
    classifyArea: classifyArea
  });
})();

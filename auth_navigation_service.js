(function () {
  "use strict";

  const APP_ORIGIN = "https://teacherflavius.com";
  const PATHS = Object.freeze({
    studentArea: "/area-do-estudante/",
    login: "/login/",
    onboarding: "/complete-cadastro/",
    profile: "/perfil/"
  });

  function normalizeNextPath(value, fallback) {
    const safeFallback = fallback || PATHS.studentArea;
    const text = String(value || "").trim();

    if (!text || !text.startsWith("/") || text.startsWith("//")) {
      return safeFallback;
    }

    return text;
  }

  function getRedirectUrl() {
    return APP_ORIGIN + PATHS.login;
  }

  function getGoogleRedirectUrl(nextPath) {
    const next = normalizeNextPath(nextPath, PATHS.studentArea);
    return APP_ORIGIN + PATHS.login + "?oauth=google&next=" + encodeURIComponent(next);
  }

  function getGoogleLinkRedirectUrl() {
    return APP_ORIGIN + PATHS.profile + "?google_linked=1";
  }

  window.AuthNavigationService = Object.freeze({
    paths: PATHS,
    normalizeNextPath: normalizeNextPath,
    getRedirectUrl: getRedirectUrl,
    getGoogleRedirectUrl: getGoogleRedirectUrl,
    getGoogleLinkRedirectUrl: getGoogleLinkRedirectUrl
  });
})();

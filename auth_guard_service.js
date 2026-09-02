(function () {
  "use strict";

  function create(options) {
    const settings = options || {};
    const isConfigured = settings.isConfigured;
    const showConfigWarning = settings.showConfigWarning;
    const getSession = settings.getSession;
    const ensureProfileForUser = settings.ensureProfileForUser;
    const normalizeNextPath = settings.normalizeNextPath;
    const loginPath = settings.loginPath;
    const onboardingPath = settings.onboardingPath;
    const studentAreaPath = settings.studentAreaPath;

    function getCurrentPath() {
      const currentPath = window.location.pathname + window.location.search;
      return normalizeNextPath(currentPath, studentAreaPath);
    }

    function isOnOnboardingPage() {
      return window.location.pathname === onboardingPath;
    }

    function redirectToLogin() {
      window.location.href = loginPath + "?next=" + encodeURIComponent(getCurrentPath());
    }

    function redirectToOnboarding() {
      window.location.replace(
        onboardingPath + "?next=" + encodeURIComponent(getCurrentPath())
      );
    }

    async function requireAuth(options) {
      const guardOptions = options || {};

      if (!isConfigured()) {
        showConfigWarning();
        return null;
      }

      const session = await getSession();
      if (!session) {
        redirectToLogin();
        return null;
      }

      if (guardOptions.skipProfileCheck || isOnOnboardingPage()) {
        return session.user;
      }

      try {
        const profile = await ensureProfileForUser(session.user);
        if (!profile || profile.profile_completed !== true) {
          redirectToOnboarding();
          return null;
        }
      } catch (error) {
        console.error("Não foi possível verificar o cadastro do usuário:", error);
      }

      return session.user;
    }

    return {
      requireAuth: requireAuth
    };
  }

  window.AuthGuardService = {
    create: create
  };
})();

(function () {
  "use strict";

  function create(options) {
    const settings = options || {};
    const isConfigured = settings.isConfigured;
    const showConfigWarning = settings.showConfigWarning;
    const getSession = settings.getSession;
    const ensureProfileForUser = settings.ensureProfileForUser;
    const isTeacherAdmin = settings.isTeacherAdmin;
    const normalizeNextPath = settings.normalizeNextPath;
    const loginPath = settings.loginPath;
    const onboardingPath = settings.onboardingPath;
    const profilePath = settings.profilePath;
    const studentAreaPath = settings.studentAreaPath;
    const accessDeniedPath = settings.accessDeniedPath;

    function getCurrentPath() {
      const currentPath = window.location.pathname + window.location.search;
      return normalizeNextPath(currentPath, studentAreaPath);
    }

    function isOnOnboardingPage() {
      return window.location.pathname === onboardingPath;
    }

    function isOnAccountManagementPage() {
      return window.location.pathname === profilePath;
    }

    function redirectToLogin() {
      window.location.href = loginPath + "?next=" + encodeURIComponent(getCurrentPath());
    }

    function redirectToOnboarding() {
      window.location.replace(
        onboardingPath + "?next=" + encodeURIComponent(getCurrentPath())
      );
    }

    function redirectToAccessDenied() {
      window.location.replace(accessDeniedPath);
    }

    function isActiveStudent(profile) {
      return !!profile &&
        profile.profile_completed === true &&
        profile.enrolled === true &&
        profile.archived !== true;
    }

    async function teacherHasAccess(guardOptions) {
      if (guardOptions.allowTeacher === false || typeof isTeacherAdmin !== "function") {
        return false;
      }

      try {
        return await isTeacherAdmin();
      } catch (error) {
        console.warn("Não foi possível confirmar o perfil de professor:", error);
        return false;
      }
    }

    async function requireAuth(options) {
      const guardOptions = options || {};
      const requiresActiveStudent = guardOptions.requireActiveStudent !== false && !isOnAccountManagementPage();

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

      if (requiresActiveStudent && await teacherHasAccess(guardOptions)) {
        return session.user;
      }

      try {
        const profile = await ensureProfileForUser(session.user);
        if (!profile || profile.profile_completed !== true) {
          redirectToOnboarding();
          return null;
        }

        if (requiresActiveStudent && !isActiveStudent(profile)) {
          redirectToAccessDenied();
          return null;
        }
      } catch (error) {
        console.error("Não foi possível verificar o cadastro do usuário:", error);
        if (requiresActiveStudent) {
          redirectToAccessDenied();
          return null;
        }
      }

      return session.user;
    }

    return Object.freeze({
      requireAuth: requireAuth
    });
  }

  window.AuthGuardService = Object.freeze({
    create: create
  });
})();

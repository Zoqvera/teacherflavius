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

    function isConnectionFailure(error) {
      if (!error) return false;

      const status = error.status;
      if (typeof status === "number" && (status === 0 || status >= 500)) {
        return true;
      }

      const description = [error.name, error.message, error.details]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return /failed to fetch|fetch failed|load failed|network ?error|network request failed|connection refused|econnreset|etimedout|timeout|offline|authretryablefetcherror/.test(description);
    }

    function redirectToVerificationFailure(error) {
      const reason = isConnectionFailure(error) ? "connection" : "verification";
      window.location.replace(
        accessDeniedPath + "?reason=" + reason + "&next=" + encodeURIComponent(getCurrentPath())
      );
    }

    function isActiveStudent(profile) {
      return !!profile &&
        profile.profile_completed === true &&
        profile.enrolled === true &&
        profile.archived !== true;
    }

    async function isPromotionFirstPaymentPending(profile) {
      if (profile.first_payment_same_day_required !== true ||
          !profile.enrolled_at ||
          String(profile.enrolled_at) < "2026-11-09") return false;

      const client = typeof settings.getClient === "function" ? settings.getClient() : null;
      if (!client) throw new Error("Não foi possível verificar o pagamento da matrícula.");

      const response = await client.rpc("get_my_matricula80_payment_gate");
      if (response.error) throw response.error;
      return !!response.data && response.data.payment_required === true;
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

      let session;
      try {
        session = await getSession();
      } catch (error) {
        console.error("Não foi possível consultar a sessão:", error);
        redirectToVerificationFailure(error);
        return null;
      }

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
        if (requiresActiveStudent && await isPromotionFirstPaymentPending(profile)) {
          const policy = await settings.getClient().rpc("get_my_enrollment_checkout_policy");
          if (policy.error) throw policy.error;
          if (!policy.data || typeof policy.data.applies !== "boolean") {
            throw new Error("Não foi possível verificar as condições de pagamento.");
          }
          window.location.replace(policy.data.applies ? "/matricula-concluida/" : "/pagamento/?matricula80=1");
          return null;
        }
      } catch (error) {
        console.error("Não foi possível verificar o cadastro do usuário:", error);
        if (requiresActiveStudent) {
          redirectToVerificationFailure(error);
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

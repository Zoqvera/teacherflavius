(function () {
  "use strict";

  const APP_ORIGIN = "https://teacherflavius.com";
  const PATHS = Object.freeze({
    studentArea: "/area-do-estudante/",
    login: "/login/",
    onboarding: "/complete-cadastro/",
    profile: "/perfil/"
  });
  const MODULE_LOADER = Object.freeze({
    selector: 'script[src^="/module_loader.js"]',
    src: "/module_loader.js?v=20260902-1"
  });
  const MODULES = Object.freeze({
    infrastructure: Object.freeze({
      globalName: "AuthInfrastructure",
      selector: 'script[src^="/auth_infrastructure.js"]',
      src: "/auth_infrastructure.js?v=20260902-1",
      missingMessage: "A infraestrutura de autenticação não foi inicializada.",
      loadErrorMessage: "Não foi possível carregar a infraestrutura de autenticação."
    }),
    authSessionService: Object.freeze({
      globalName: "AuthSessionService",
      selector: 'script[src^="/auth_session_service.js"]',
      src: "/auth_session_service.js?v=20260902-1",
      missingMessage: "O serviço de sessão não foi inicializado.",
      loadErrorMessage: "Não foi possível carregar o serviço de sessão."
    }),
    authGuardService: Object.freeze({
      globalName: "AuthGuardService",
      selector: 'script[src^="/auth_guard_service.js"]',
      src: "/auth_guard_service.js?v=20260902-1",
      missingMessage: "O serviço de guarda de autenticação não foi inicializado.",
      loadErrorMessage: "Não foi possível carregar o serviço de guarda de autenticação."
    }),
    studentProfileService: Object.freeze({
      globalName: "StudentProfileService",
      selector: 'script[src^="/student_profile_service.js"]',
      src: "/student_profile_service.js?v=20260902-1",
      missingMessage: "O serviço de perfil do aluno não foi inicializado.",
      loadErrorMessage: "Não foi possível carregar o serviço de perfil do aluno."
    }),
    activityProgressService: Object.freeze({
      globalName: "ActivityProgressService",
      selector: 'script[src^="/activity_progress_service.js"]',
      src: "/activity_progress_service.js?v=20260902-1",
      missingMessage: "O serviço de progresso das atividades não foi inicializado.",
      loadErrorMessage: "Não foi possível carregar o serviço de progresso das atividades."
    })
  });

  let moduleLoaderPromise = null;
  let studentEnrollmentService = null;
  let authSessionService = null;
  let authGuardService = null;
  let studentProfileService = null;
  let activityProgressService = null;

  function getModuleLoader() {
    if (window.ModuleLoader) return Promise.resolve(window.ModuleLoader);
    if (moduleLoaderPromise) return moduleLoaderPromise;

    moduleLoaderPromise = new Promise(function (resolve, reject) {
      function resolveLoader() {
        if (!window.ModuleLoader) {
          reject(new Error("O carregador de módulos não foi inicializado."));
          return;
        }
        resolve(window.ModuleLoader);
      }

      function rejectLoader() {
        reject(new Error("Não foi possível carregar o carregador de módulos."));
      }

      const existingScript = document.querySelector(MODULE_LOADER.selector);
      if (existingScript) {
        existingScript.addEventListener("load", resolveLoader, { once: true });
        existingScript.addEventListener("error", rejectLoader, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = MODULE_LOADER.src;
      script.async = true;
      script.addEventListener("load", resolveLoader, { once: true });
      script.addEventListener("error", rejectLoader, { once: true });
      document.head.appendChild(script);
    });

    return moduleLoaderPromise;
  }

  function loadGlobalModule(config) {
    return getModuleLoader().then(function (moduleLoader) {
      return moduleLoader.loadGlobalModule(config);
    });
  }

  function getAuthInfrastructure() {
    return loadGlobalModule(MODULES.infrastructure);
  }

  function initializeAuthInfrastructure() {
    getAuthInfrastructure()
      .then(function (infrastructure) {
        infrastructure.initialize({ pathname: window.location.pathname });
      })
      .catch(function (error) {
        console.warn("Não foi possível inicializar recursos auxiliares de autenticação:", error);
      });
  }

  function showConfigWarning() {
    getAuthInfrastructure()
      .then(function (infrastructure) {
        infrastructure.showConfigWarning();
      })
      .catch(function (error) {
        console.warn("Não foi possível exibir o aviso de configuração do Supabase:", error);
      });
  }

  function getSupabaseClientService() {
    const service = window.SupabaseClientService;
    if (!service) {
      throw new Error("O serviço do cliente Supabase não foi inicializado.");
    }
    return service;
  }

  function getStudentEnrollmentServiceModule() {
    const service = window.StudentEnrollmentService;
    if (!service) {
      throw new Error("O serviço de matrícula do aluno não foi inicializado.");
    }
    return service;
  }

  function getStudentEnrollmentService() {
    if (!studentEnrollmentService) {
      studentEnrollmentService = getStudentEnrollmentServiceModule().create({
        requireClient: requireClient,
        getRedirectUrl: getRedirectUrl
      });
    }
    return studentEnrollmentService;
  }

  function isConfigured() {
    return getSupabaseClientService().isConfigured();
  }

  function getClient() {
    return getSupabaseClientService().getClient();
  }

  function requireClient() {
    return getSupabaseClientService().requireClient();
  }

  function normalizeNextPath(value, fallback) {
    const safeFallback = fallback || PATHS.studentArea;
    const text = String(value || "").trim();
    if (!text || !text.startsWith("/") || text.startsWith("//")) return safeFallback;
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

  function generateEnrollmentCode() {
    return getStudentEnrollmentServiceModule().generateEnrollmentCode();
  }

  function getAuthSessionService() {
    if (authSessionService) return Promise.resolve(authSessionService);

    return loadGlobalModule(MODULES.authSessionService).then(function (serviceModule) {
      if (!authSessionService) {
        authSessionService = serviceModule.create({
          getClient: getClient,
          requireClient: requireClient,
          getGoogleRedirectUrl: getGoogleRedirectUrl,
          getGoogleLinkRedirectUrl: getGoogleLinkRedirectUrl,
          loginPath: PATHS.login
        });
      }
      return authSessionService;
    });
  }

  async function getSession() {
    const service = await getAuthSessionService();
    return service.getSession();
  }

  async function getUser() {
    const service = await getAuthSessionService();
    return service.getUser();
  }

  function getStudentProfileService() {
    if (studentProfileService) return Promise.resolve(studentProfileService);

    return loadGlobalModule(MODULES.studentProfileService).then(function (serviceModule) {
      if (!studentProfileService) {
        studentProfileService = serviceModule.create({
          getClient: getClient,
          requireClient: requireClient,
          getUser: getUser,
          getRedirectUrl: getRedirectUrl,
          generateEnrollmentCode: generateEnrollmentCode
        });
      }
      return studentProfileService;
    });
  }

  function getActivityProgressService() {
    if (activityProgressService) return Promise.resolve(activityProgressService);

    return loadGlobalModule(MODULES.activityProgressService).then(function (serviceModule) {
      if (!activityProgressService) {
        activityProgressService = serviceModule.create({
          getClient: getClient,
          getUser: getUser
        });
      }
      return activityProgressService;
    });
  }

  function getAuthGuardService() {
    if (authGuardService) return Promise.resolve(authGuardService);

    return loadGlobalModule(MODULES.authGuardService).then(function (serviceModule) {
      if (!authGuardService) {
        authGuardService = serviceModule.create({
          isConfigured: isConfigured,
          showConfigWarning: showConfigWarning,
          getSession: getSession,
          ensureProfileForUser: ensureProfileForUser,
          normalizeNextPath: normalizeNextPath,
          loginPath: PATHS.login,
          onboardingPath: PATHS.onboarding,
          studentAreaPath: PATHS.studentArea
        });
      }
      return authGuardService;
    });
  }

  async function ensureProfileForUser(user) {
    const service = await getStudentProfileService();
    return service.ensureProfileForUser(user);
  }

  async function enrollStudent(data) {
    const service = await getStudentProfileService();
    return service.enrollStudent(data);
  }

  async function getProfile() {
    const service = await getStudentProfileService();
    return service.getProfile();
  }

  async function updateProfile(data) {
    const service = await getStudentProfileService();
    return service.updateProfile(data);
  }

  async function completeProfile(data) {
    const service = await getStudentProfileService();
    return service.completeProfile(data);
  }

  async function saveActivityResult(result) {
    const service = await getActivityProgressService();
    return service.saveActivityResult(result);
  }

  async function getMyResults() {
    const service = await getActivityProgressService();
    return service.getMyResults();
  }

  async function requireAuth(options) {
    const service = await getAuthGuardService();
    return service.requireAuth(options);
  }

  async function signUp(name, email, password) {
    return getStudentEnrollmentService().signUp(name, email, password);
  }

  async function signIn(email, password) {
    const service = await getAuthSessionService();
    return service.signIn(email, password);
  }

  async function signInWithGoogle(nextPath) {
    const service = await getAuthSessionService();
    return service.signInWithGoogle(nextPath);
  }

  async function linkGoogleIdentity() {
    const service = await getAuthSessionService();
    return service.linkGoogleIdentity();
  }

  async function getUserIdentities() {
    const service = await getAuthSessionService();
    return service.getUserIdentities();
  }

  async function signOut() {
    const service = await getAuthSessionService();
    return service.signOut();
  }

  window.Auth = {
    isConfigured: isConfigured,
    getClient: getClient,
    showConfigWarning: showConfigWarning,
    generateEnrollmentCode: generateEnrollmentCode,
    getSession: getSession,
    getUser: getUser,
    ensureProfileForUser: ensureProfileForUser,
    requireAuth: requireAuth,
    signUp: signUp,
    enrollStudent: enrollStudent,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    linkGoogleIdentity: linkGoogleIdentity,
    getUserIdentities: getUserIdentities,
    signOut: signOut,
    getProfile: getProfile,
    updateProfile: updateProfile,
    completeProfile: completeProfile,
    saveActivityResult: saveActivityResult,
    getMyResults: getMyResults,
    normalizeNextPath: normalizeNextPath
  };

  initializeAuthInfrastructure();
})();

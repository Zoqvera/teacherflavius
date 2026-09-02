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
  const ENROLLMENT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ENROLLMENT_CODE_LENGTH = 5;

  let moduleLoaderPromise = null;
  let authSessionService = null;
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

  function isConfigured() {
    return !!(
      window.SUPABASE_CONFIG &&
      window.SUPABASE_CONFIG.url &&
      window.SUPABASE_CONFIG.anonKey &&
      !window.SUPABASE_CONFIG.url.includes("COLE_AQUI") &&
      !window.SUPABASE_CONFIG.anonKey.includes("COLE_AQUI")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!window.supabase || !window.supabase.createClient) return null;

    if (!window.teacherFlavioSupabase) {
      window.teacherFlavioSupabase = window.supabase.createClient(
        window.SUPABASE_CONFIG.url,
        window.SUPABASE_CONFIG.anonKey
      );
    }
    return window.teacherFlavioSupabase;
  }

  function requireClient() {
    const client = getClient();
    if (!client) throw new Error("Supabase não configurado.");
    return client;
  }

  function normalizeNextPath(value, fallback) {
    const safeFallback = fallback || PATHS.studentArea;
    const text = String(value || "").trim();
    if (!text || !text.startsWith("/") || text.startsWith("//")) return safeFallback;
    return text;
  }

  function getCurrentPath() {
    return normalizeNextPath(window.location.pathname + window.location.search, PATHS.studentArea);
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

  function isOnOnboardingPage() {
    return window.location.pathname === PATHS.onboarding;
  }

  function generateEnrollmentCode() {
    let code = "";
    for (let index = 0; index < ENROLLMENT_CODE_LENGTH; index += 1) {
      const randomIndex = Math.floor(Math.random() * ENROLLMENT_CODE_ALPHABET.length);
      code += ENROLLMENT_CODE_ALPHABET[randomIndex];
    }
    return code;
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
    const settings = options || {};
    if (!isConfigured()) {
      showConfigWarning();
      return null;
    }

    const session = await getSession();
    if (!session) {
      window.location.href = PATHS.login + "?next=" + encodeURIComponent(getCurrentPath());
      return null;
    }

    if (!settings.skipProfileCheck && !isOnOnboardingPage()) {
      try {
        const profile = await ensureProfileForUser(session.user);
        if (!profile || profile.profile_completed !== true) {
          window.location.replace(PATHS.onboarding + "?next=" + encodeURIComponent(getCurrentPath()));
          return null;
        }
      } catch (error) {
        console.error("Não foi possível verificar o cadastro do usuário:", error);
      }
    }
    return session.user;
  }

  async function signUp(name, email, password) {
    const client = requireClient();
    const response = await client.auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name }, emailRedirectTo: getRedirectUrl() }
    });
    if (response.error) throw response.error;

    if (response.data && response.data.user) {
      await client.from("profiles").upsert({
        id: response.data.user.id,
        name: name,
        email: email,
        profile_completed: true
      });
    }
    return response.data;
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
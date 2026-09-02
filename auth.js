(function () {
  "use strict";

  const APP_ORIGIN = "https://teacherflavius.com";
  const PATHS = Object.freeze({
    studentArea: "/area-do-estudante/",
    login: "/login/",
    onboarding: "/complete-cadastro/",
    profile: "/perfil/"
  });
  const MODULES = Object.freeze({
    infrastructure: Object.freeze({
      globalName: "AuthInfrastructure",
      selector: 'script[src^="/auth_infrastructure.js"]',
      src: "/auth_infrastructure.js?v=20260902-1",
      missingMessage: "A infraestrutura de autenticação não foi inicializada.",
      loadErrorMessage: "Não foi possível carregar a infraestrutura de autenticação."
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
  const GOOGLE_PROVIDER = "google";

  const modulePromises = {};
  let studentProfileService = null;
  let activityProgressService = null;

  function loadGlobalModule(config) {
    const existingModule = window[config.globalName];
    if (existingModule) return Promise.resolve(existingModule);
    if (modulePromises[config.globalName]) return modulePromises[config.globalName];

    modulePromises[config.globalName] = new Promise(function (resolve, reject) {
      function resolveModule() {
        const loadedModule = window[config.globalName];
        if (!loadedModule) {
          reject(new Error(config.missingMessage));
          return;
        }
        resolve(loadedModule);
      }

      function rejectModule() {
        reject(new Error(config.loadErrorMessage));
      }

      const existingScript = document.querySelector(config.selector);
      if (existingScript) {
        existingScript.addEventListener("load", resolveModule, { once: true });
        existingScript.addEventListener("error", rejectModule, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = config.src;
      script.async = true;
      script.addEventListener("load", resolveModule, { once: true });
      script.addEventListener("error", rejectModule, { once: true });
      document.head.appendChild(script);
    });

    return modulePromises[config.globalName];
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

  async function getSession() {
    const client = getClient();
    if (!client) return null;
    const response = await client.auth.getSession();
    return response && response.data ? response.data.session : null;
  }

  async function getUser() {
    const client = getClient();
    if (!client) return null;
    const response = await client.auth.getUser();
    return response && response.data ? response.data.user : null;
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
    const client = requireClient();
    const response = await client.auth.signInWithPassword({ email: email, password: password });
    if (response.error) throw response.error;
    return response.data;
  }

  async function signInWithGoogle(nextPath) {
    const client = requireClient();
    const response = await client.auth.signInWithOAuth({
      provider: GOOGLE_PROVIDER,
      options: {
        redirectTo: getGoogleRedirectUrl(nextPath),
        queryParams: { prompt: "select_account" }
      }
    });
    if (response.error) throw response.error;
    return response.data;
  }

  async function linkGoogleIdentity() {
    const client = getClient();
    const user = await getUser();
    if (!client || !user) throw new Error("Entre na sua conta antes de vincular o Google.");

    const response = await client.auth.linkIdentity({
      provider: GOOGLE_PROVIDER,
      options: { redirectTo: getGoogleLinkRedirectUrl() }
    });
    if (response.error) throw response.error;
    return response.data;
  }

  async function getUserIdentities() {
    const client = getClient();
    if (!client) return [];
    const response = await client.auth.getUserIdentities();
    if (response.error) throw response.error;
    return response.data && Array.isArray(response.data.identities) ? response.data.identities : [];
  }

  async function signOut() {
    const client = getClient();
    if (!client) {
      window.location.replace(PATHS.login + "?logged_out=1");
      return;
    }

    const response = await client.auth.signOut({ scope: "local" });
    if (response.error) throw response.error;
    window.location.replace(PATHS.login + "?logged_out=1");
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
(function () {
  "use strict";

  const APP_ORIGIN = "https://teacherflavius.com";
  const PATHS = Object.freeze({
    studentArea: "/area-do-estudante/",
    login: "/login/",
    onboarding: "/complete-cadastro/",
    profile: "/perfil/"
  });
  const ENROLLMENT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ENROLLMENT_CODE_LENGTH = 5;
  const AVAILABILITY_DAYS = Object.freeze(["seg", "ter", "qua", "qui", "sex"]);
  const AVAILABILITY_HOURS = Object.freeze(["09", "10", "12", "13", "15", "17", "18", "20", "21"]);
  const GOOGLE_PROVIDER = "google";

  function runWhenDomReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  function appendStylesheetOnce(selector, href) {
    if (document.querySelector(selector)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function appendScriptOnce(selector, src) {
    if (document.querySelector(selector)) return;
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  function loadSharedAssets() {
    runWhenDomReady(function () {
      appendStylesheetOnce('link[href^="animated_cards.css"]', "animated_cards.css?v=20260429-6");
      appendScriptOnce('script[src^="animated_cards.js"]', "animated_cards.js?v=20260716-logout-1");
      appendScriptOnce('script[src^="/student_access_tracker.js"]', "/student_access_tracker.js?v=20260730-2");
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

  function isOnLoginPage() {
    return window.location.pathname === PATHS.login;
  }

  function isOnProfilePage() {
    return window.location.pathname === PATHS.profile;
  }

  function showConfigWarning() {
    if (document.getElementById("supabase-config-warning")) return;

    const warning = document.createElement("div");
    warning.id = "supabase-config-warning";
    warning.style.position = "fixed";
    warning.style.left = "12px";
    warning.style.right = "12px";
    warning.style.bottom = "12px";
    warning.style.zIndex = "20000";
    warning.style.background = "rgba(251,191,36,0.12)";
    warning.style.border = "1px solid rgba(251,191,36,0.35)";
    warning.style.color = "#fde68a";
    warning.style.borderRadius = "12px";
    warning.style.padding = "12px 14px";
    warning.style.fontFamily = "Georgia, serif";
    warning.style.fontSize = "13px";
    warning.style.lineHeight = "1.5";
    warning.textContent = "Supabase ainda não configurado. Edite supabase_config.js com a URL e a chave pública anon do seu projeto.";
    document.body.appendChild(warning);
  }

  function generateEnrollmentCode() {
    let code = "";
    for (let index = 0; index < ENROLLMENT_CODE_LENGTH; index += 1) {
      const randomIndex = Math.floor(Math.random() * ENROLLMENT_CODE_ALPHABET.length);
      code += ENROLLMENT_CODE_ALPHABET[randomIndex];
    }
    return code;
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeCpf(cpf) {
    return normalizeDigits(cpf);
  }

  function normalizeWhatsapp(whatsapp) {
    return normalizeDigits(whatsapp);
  }

  function normalizePixKey(pixKey) {
    return String(pixKey || "").trim();
  }

  function normalizeAvailability(availability) {
    const normalized = {};
    AVAILABILITY_DAYS.forEach(function (day) {
      const selected = Array.isArray(availability && availability[day]) ? availability[day] : [];
      normalized[day] = selected.filter(function (hour) {
        return AVAILABILITY_HOURS.includes(hour);
      });
    });
    return normalized;
  }

  function countAvailabilitySlots(availability) {
    return Object.keys(availability || {}).reduce(function (total, day) {
      return total + (Array.isArray(availability[day]) ? availability[day].length : 0);
    }, 0);
  }

  function availabilityToProfileColumns(availability) {
    const columns = {};
    AVAILABILITY_DAYS.forEach(function (day) {
      AVAILABILITY_HOURS.forEach(function (hour) {
        columns["availability_" + day + "_" + hour] = Array.isArray(availability[day]) && availability[day].includes(hour);
      });
    });
    return columns;
  }

  function normalizeStudentInput(data) {
    const source = data || {};
    return {
      name: source.name || "",
      email: source.email || "",
      password: source.password || "",
      cpf: normalizeCpf(source.cpf),
      whatsapp: normalizeWhatsapp(source.whatsapp),
      pixKey: normalizePixKey(source.pix_key),
      availability: normalizeAvailability(source.availability)
    };
  }

  function validateStudentInput(input, requiredFieldsMessage, options) {
    const settings = options || {};
    const hasRequiredIdentity = input.name && input.cpf && input.whatsapp && input.pixKey;
    const hasEnrollmentCredentials = !settings.requireEnrollmentCredentials || (input.email && input.password);

    if (!hasRequiredIdentity || !hasEnrollmentCredentials) throw new Error(requiredFieldsMessage);
    if (input.cpf.length !== 11) throw new Error("CPF inválido. Informe 11 dígitos.");
    if (input.whatsapp.length < 10) throw new Error("WhatsApp inválido.");
    if (countAvailabilitySlots(input.availability) === 0) {
      throw new Error("Selecione pelo menos um horário disponível para aulas durante a semana.");
    }
  }

  function buildProfilePayload(options) {
    const input = options.input;
    return Object.assign({
      id: options.userId,
      name: input.name,
      email: options.email || "",
      cpf: input.cpf,
      whatsapp: input.whatsapp,
      pix_key: input.pixKey,
      availability: input.availability,
      enrollment_code: options.enrollmentCode || "",
      enrolled: options.enrolled === true,
      profile_completed: true
    }, availabilityToProfileColumns(input.availability));
  }

  function buildUserMetadata(input, enrollmentCode, enrolled) {
    return {
      name: input.name,
      cpf: input.cpf,
      whatsapp: input.whatsapp,
      pix_key: input.pixKey,
      availability: input.availability,
      enrollment_code: enrollmentCode || "",
      enrolled: enrolled === true,
      profile_completed: true
    };
  }

  async function updateAuthMetadata(client, input, enrollmentCode, enrolled) {
    const response = await client.auth.updateUser({
      data: buildUserMetadata(input, enrollmentCode, enrolled)
    });
    if (response.error) throw response.error;
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

  async function ensureProfileForUser(user) {
    const client = getClient();
    if (!client || !user) return null;

    const existing = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;

    const metadata = user.user_metadata || {};
    const payload = {
      id: user.id,
      name: metadata.full_name || metadata.name || metadata.user_name || "",
      email: user.email || "",
      enrolled: false,
      profile_completed: false
    };
    const created = await client.from("profiles").insert(payload).select().single();
    if (created.error) throw created.error;
    return created.data;
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

  async function enrollStudent(data) {
    const client = requireClient();
    const input = normalizeStudentInput(data);
    validateStudentInput(input, "Preencha todos os campos da matrícula.", { requireEnrollmentCredentials: true });

    const enrollmentCode = generateEnrollmentCode();
    const enrollmentMetadata = buildUserMetadata(input, enrollmentCode, true);
    const response = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: enrollmentMetadata, emailRedirectTo: getRedirectUrl() }
    });
    if (response.error) throw response.error;

    if (response.data && response.data.user) {
      const profilePayload = buildProfilePayload({
        userId: response.data.user.id,
        email: input.email,
        input: input,
        enrollmentCode: enrollmentCode,
        enrolled: true
      });
      const profileResponse = await client.from("profiles").upsert(profilePayload).select().single();
      if (profileResponse.error) {
        console.warn("Não foi possível atualizar profiles com os dados de matrícula:", profileResponse.error.message);
      }
    }

    return {
      user: response.data ? response.data.user : null,
      enrollment_code: enrollmentCode
    };
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

  async function getProfile() {
    const client = getClient();
    const user = await getUser();
    if (!client || !user) return null;

    const response = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const metadata = user.user_metadata || {};
    const fallbackProfile = {
      id: user.id,
      name: metadata.full_name || metadata.name || "",
      email: user.email,
      cpf: metadata.cpf || "",
      whatsapp: metadata.whatsapp || "",
      pix_key: metadata.pix_key || "",
      availability: metadata.availability || {},
      enrollment_code: metadata.enrollment_code || "",
      enrolled: metadata.enrolled || false,
      profile_completed: metadata.profile_completed || false
    };
    if (response.error || !response.data) return fallbackProfile;
    return Object.assign({}, fallbackProfile, response.data);
  }

  async function updateProfile(data) {
    const client = getClient();
    const user = await getUser();
    if (!client || !user) throw new Error("Usuário não autenticado.");

    const input = normalizeStudentInput(data);
    validateStudentInput(input, "Preencha nome, CPF, WhatsApp e chave PIX.");

    const currentProfile = await getProfile();
    const enrollmentCode = currentProfile && currentProfile.enrollment_code || "";
    const enrolled = currentProfile && currentProfile.enrolled === true;
    const profilePayload = buildProfilePayload({
      userId: user.id,
      email: user.email,
      input: input,
      enrollmentCode: enrollmentCode,
      enrolled: enrolled
    });

    const profileResponse = await client.from("profiles").upsert(profilePayload).select().single();
    if (profileResponse.error) throw profileResponse.error;
    await updateAuthMetadata(client, input, enrollmentCode, enrolled);
    return profileResponse.data;
  }

  async function completeProfile(data) {
    const client = getClient();
    const user = await getUser();
    if (!client || !user) throw new Error("Sua sessão expirou. Entre novamente.");

    const input = normalizeStudentInput(data);
    validateStudentInput(input, "Preencha todos os campos obrigatórios.");

    const current = await ensureProfileForUser(user);
    const enrollmentCode = current.enrollment_code || "";
    const enrolled = current.enrolled === true;
    const payload = buildProfilePayload({
      userId: user.id,
      email: user.email || current.email || "",
      input: input,
      enrollmentCode: enrollmentCode,
      enrolled: enrolled
    });

    const saved = await client.from("profiles").upsert(payload).select().single();
    if (saved.error) throw saved.error;
    await updateAuthMetadata(client, input, enrollmentCode, enrolled);
    return saved.data;
  }

  async function saveActivityResult(result) {
    const client = getClient();
    const user = await getUser();
    if (!client || !user) return null;

    const payload = {
      user_id: user.id,
      activity_type: result.activity_type || result.type || "activity",
      activity_title: result.activity_title || result.quiz || result.title,
      score: Number(result.score),
      total: Number(result.total),
      percentage: Math.round((Number(result.score) / Number(result.total)) * 100),
      completed_at: new Date().toISOString()
    };
    const response = await client.from("activity_results").insert(payload).select().single();
    if (response.error) {
      console.warn("Erro ao salvar no Supabase:", response.error.message);
      return null;
    }
    return response.data;
  }

  async function getMyResults() {
    const client = getClient();
    const user = await getUser();
    if (!client || !user) return [];

    const response = await client
      .from("activity_results")
      .select("*")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false });
    if (response.error) return [];
    return response.data || [];
  }

  function injectGoogleStyles() {
    if (document.getElementById("teacher-google-auth-styles")) return;
    const style = document.createElement("style");
    style.id = "teacher-google-auth-styles";
    style.textContent = `.google-auth-block{margin:0 0 18px}.google-auth-button{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px;border-radius:12px;border:1.5px solid rgba(255,255,255,.22);background:#fff;color:#1f2937;font:700 15px Georgia,serif;cursor:pointer}.google-auth-button:hover{background:#f8fafc}.google-auth-button:disabled{opacity:.65;cursor:wait}.google-auth-g{font-family:Arial,sans-serif;font-size:20px;font-weight:700}.google-auth-divider{display:flex;align-items:center;gap:10px;color:#64748b;font-size:12px;margin:16px 0}.google-auth-divider:before,.google-auth-divider:after{content:"";flex:1;height:1px;background:rgba(255,255,255,.12)}.google-auth-note{margin-top:10px;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center}.google-link-status{color:#cbd5e1;margin:0 0 14px}.google-link-success{color:#6ee7b7}`;
    document.head.appendChild(style);
  }

  async function finishGoogleLogin() {
    if (!isOnLoginPage()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") !== GOOGLE_PROVIDER) return;

    const errorBox = document.getElementById("error");
    try {
      const session = await getSession();
      if (!session || !session.user) throw new Error("Não foi possível concluir o login com Google.");

      const profile = await ensureProfileForUser(session.user);
      const next = normalizeNextPath(params.get("next"), PATHS.studentArea);
      if (!profile || profile.profile_completed !== true) {
        window.location.replace(PATHS.onboarding + "?next=" + encodeURIComponent(next));
        return;
      }
      window.location.replace(next);
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message || "Não foi possível concluir o login com Google.";
    }
  }

  function setupGoogleLoginUi() {
    if (!isOnLoginPage()) return;
    const form = document.getElementById("loginForm");
    if (!form || document.getElementById("googleLoginBlock")) return;

    injectGoogleStyles();
    const block = document.createElement("div");
    block.id = "googleLoginBlock";
    block.className = "google-auth-block";
    block.innerHTML = `<button id="googleLoginButton" class="google-auth-button" type="button"><span class="google-auth-g">G</span> CONTINUAR COM GOOGLE</button><div class="google-auth-note">Alunos atuais: para preservar todo o histórico, entre primeiro com seu e-mail e senha e vincule o Google em Meu Perfil.</div><div class="google-auth-divider"><span>OU</span></div>`;
    form.parentNode.insertBefore(block, form);

    const button = document.getElementById("googleLoginButton");
    button.addEventListener("click", async function () {
      const params = new URLSearchParams(window.location.search);
      const next = normalizeNextPath(params.get("next"), PATHS.studentArea);
      button.disabled = true;
      button.textContent = "ABRINDO GOOGLE...";
      try {
        await signInWithGoogle(next);
      } catch (error) {
        button.disabled = false;
        button.innerHTML = '<span class="google-auth-g">G</span> CONTINUAR COM GOOGLE';
        const errorBox = document.getElementById("error");
        if (errorBox) errorBox.textContent = error.message || "Não foi possível iniciar o login com Google.";
      }
    });
    finishGoogleLogin();
  }

  async function setupProfileIdentityUi() {
    if (!isOnProfilePage()) return;
    const container = document.querySelector(".container");
    if (!container || document.getElementById("googleIdentityCard")) return;

    injectGoogleStyles();
    const firstCard = container.querySelector(".card");
    const card = document.createElement("div");
    card.id = "googleIdentityCard";
    card.className = "card";
    card.innerHTML = `<h2>Formas de acesso</h2><p id="googleIdentityStatus" class="google-link-status">Verificando sua conta Google...</p><button id="linkGoogleButton" type="button" class="primary" hidden>VINCULAR CONTA GOOGLE</button><div id="googleIdentityMessage" class="message"></div>`;
    if (firstCard) container.insertBefore(card, firstCard);
    else container.appendChild(card);

    const status = document.getElementById("googleIdentityStatus");
    const button = document.getElementById("linkGoogleButton");
    const message = document.getElementById("googleIdentityMessage");

    try {
      const session = await getSession();
      if (!session) return;

      const identities = await getUserIdentities();
      const googleIdentity = identities.find(function (identity) {
        return identity.provider === GOOGLE_PROVIDER;
      });

      if (googleIdentity) {
        status.classList.add("google-link-success");
        status.textContent = "✓ Conta Google vinculada. Você pode entrar com Google ou com seu login atual.";
        button.hidden = true;
      } else {
        status.textContent = "Sua conta ainda não está vinculada ao Google.";
        button.hidden = false;
      }

      const params = new URLSearchParams(window.location.search);
      if (params.get("google_linked") === "1" && googleIdentity) {
        message.className = "message success";
        message.textContent = "Conta Google vinculada com sucesso. Seus dados e seu progresso foram preservados.";
      }
    } catch (error) {
      status.textContent = "Não foi possível verificar as formas de acesso.";
      message.className = "message error";
      message.textContent = error.message || "Tente novamente.";
    }

    button.addEventListener("click", async function () {
      button.disabled = true;
      button.textContent = "ABRINDO GOOGLE...";
      message.className = "message";
      message.textContent = "";
      try {
        await linkGoogleIdentity();
      } catch (error) {
        button.disabled = false;
        button.textContent = "VINCULAR CONTA GOOGLE";
        message.className = "message error";
        message.textContent = error.message || "Não foi possível vincular a conta Google.";
      }
    });
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

  function setupGoogleAuthUi() {
    setupGoogleLoginUi();
    setupProfileIdentityUi();
  }

  loadSharedAssets();
  runWhenDomReady(setupGoogleAuthUi);
})();

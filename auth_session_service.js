(function () {
  "use strict";

  const GOOGLE_PROVIDER = "google";
  const LOCAL_SIGN_OUT_SCOPE = "local";
  const GLOBAL_SIGN_OUT_SCOPE = "global";
  const MIN_PASSWORD_LENGTH = 12;
  const LOGIN_THROTTLE_STORAGE_KEY = "teacherFlavius.auth.loginThrottle.v1";
  const PASSWORD_RESET_THROTTLE_STORAGE_KEY = "teacherFlavius.auth.passwordResetThrottle.v1";
  const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;

  function assertDependencies(dependencies) {
    const requiredFunctions = [
      "getClient",
      "requireClient",
      "getGoogleRedirectUrl",
      "getGoogleLinkRedirectUrl",
      "getPasswordRecoveryRedirectUrl"
    ];

    requiredFunctions.forEach(function (name) {
      if (typeof dependencies[name] !== "function") {
        throw new Error("Dependência inválida do serviço de sessão: " + name + ".");
      }
    });

    if (typeof dependencies.loginPath !== "string" || !dependencies.loginPath) {
      throw new Error("Dependência inválida do serviço de sessão: loginPath.");
    }
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function validateNewPassword(password) {
    const value = String(password || "");
    if (value.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        "A nova senha deve ter pelo menos " + MIN_PASSWORD_LENGTH + " caracteres."
      );
    }
    return value;
  }

  function validateCurrentPassword(password) {
    const value = String(password || "");
    if (!value) {
      throw new Error("Informe sua senha atual.");
    }
    return value;
  }

  function getLoginFailureDelayMs(failureCount) {
    if (failureCount < 3) return 0;
    if (failureCount === 3) return 5 * 1000;
    if (failureCount === 4) return 15 * 1000;
    return 60 * 1000;
  }

  function createMemoryStorage() {
    const data = Object.create(null);
    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[key] = String(value);
      },
      removeItem: function (key) {
        delete data[key];
      }
    };
  }

  function getBrowserSessionStorage() {
    try {
      return window.sessionStorage || null;
    } catch (_) {
      return null;
    }
  }

  function parseThrottleState(rawValue) {
    if (!rawValue) return { failures: 0, blockedUntil: 0 };
    try {
      const parsed = JSON.parse(rawValue);
      return {
        failures: Number.isFinite(parsed.failures) ? Math.max(0, parsed.failures) : 0,
        blockedUntil: Number.isFinite(parsed.blockedUntil) ? Math.max(0, parsed.blockedUntil) : 0
      };
    } catch (_) {
      return { failures: 0, blockedUntil: 0 };
    }
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    const now = typeof deps.now === "function" ? deps.now : Date.now;
    const throttleStorage = deps.throttleStorage || getBrowserSessionStorage() || createMemoryStorage();

    function readThrottleState(storageKey) {
      return parseThrottleState(throttleStorage.getItem(storageKey));
    }

    function writeThrottleState(storageKey, state) {
      throttleStorage.setItem(storageKey, JSON.stringify(state));
    }

    function clearThrottleState(storageKey) {
      throttleStorage.removeItem(storageKey);
    }

    function getRemainingThrottleSeconds(storageKey) {
      const state = readThrottleState(storageKey);
      const remainingMs = state.blockedUntil - now();
      return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
    }

    function assertLoginAttemptAllowed() {
      const remainingSeconds = getRemainingThrottleSeconds(LOGIN_THROTTLE_STORAGE_KEY);
      if (remainingSeconds <= 0) return;
      throw new Error(
        "Muitas tentativas de acesso. Aguarde " + remainingSeconds + " segundos e tente novamente."
      );
    }

    function registerLoginFailure() {
      const state = readThrottleState(LOGIN_THROTTLE_STORAGE_KEY);
      const failures = state.failures + 1;
      const delayMs = getLoginFailureDelayMs(failures);
      writeThrottleState(LOGIN_THROTTLE_STORAGE_KEY, {
        failures: failures,
        blockedUntil: delayMs > 0 ? now() + delayMs : 0
      });
    }

    function assertPasswordResetAllowed() {
      const remainingSeconds = getRemainingThrottleSeconds(PASSWORD_RESET_THROTTLE_STORAGE_KEY);
      if (remainingSeconds <= 0) return;
      throw new Error(
        "Aguarde " + remainingSeconds + " segundos antes de solicitar outro link de recuperação."
      );
    }

    function registerPasswordResetCooldown() {
      writeThrottleState(PASSWORD_RESET_THROTTLE_STORAGE_KEY, {
        failures: 0,
        blockedUntil: now() + PASSWORD_RESET_COOLDOWN_MS
      });
    }

    async function getSession() {
      const client = deps.getClient();
      if (!client) return null;
      const response = await client.auth.getSession();
      if (response && response.error) throw response.error;
      return response && response.data ? response.data.session : null;
    }

    function isExpiredAccessToken(error) {
      if (!error) return false;
      const message = String(error.message || "").toLowerCase();
      const code = String(error.code || "").toLowerCase();
      return (code === "bad_jwt" || error.status === 401 || error.status === 403)
        && /token is expired|jwt expired|expired jwt/.test(message);
    }

    function isAuthRejection(error) {
      if (!error) return false;
      const code = String(error.code || "").toLowerCase();
      return error.status === 400 || error.status === 401 || error.status === 403
        || ["refresh_token_not_found", "invalid_refresh_token", "session_not_found"].includes(code);
    }

    // Validate against the Auth server: a device with an incorrect clock can
    // consider an already-expired JWT valid, despite automatic token refresh.
    async function getVerifiedSession() {
      const session = await getSession();
      if (!session || !session.user || !session.user.id) return null;

      const client = deps.requireClient();
      const verification = await client.auth.getUser();
      if (!verification.error) {
        return verification.data && verification.data.user
          && verification.data.user.id === session.user.id ? session : null;
      }
      if (!isExpiredAccessToken(verification.error)) {
        if (isAuthRejection(verification.error)) return null;
        throw verification.error;
      }

      // Refresh at most once. Never retry indefinitely or bypass verification.
      const refreshed = await client.auth.refreshSession();
      if (refreshed.error) {
        if (isAuthRejection(refreshed.error)) return null;
        throw refreshed.error;
      }
      const renewedSession = refreshed.data && refreshed.data.session;
      if (!renewedSession || !renewedSession.user || !renewedSession.user.id) return null;

      const renewedVerification = await client.auth.getUser();
      if (renewedVerification.error) {
        if (isAuthRejection(renewedVerification.error)) return null;
        throw renewedVerification.error;
      }
      return renewedVerification.data && renewedVerification.data.user
        && renewedVerification.data.user.id === renewedSession.user.id
        ? renewedSession : null;
    }

    async function getUser() {
      const client = deps.getClient();
      if (!client) return null;
      const response = await client.auth.getUser();
      return response && response.data ? response.data.user : null;
    }

    async function signIn(email, password) {
      assertLoginAttemptAllowed();
      const client = deps.requireClient();
      const response = await client.auth.signInWithPassword({
        email: email,
        password: password
      });
      if (response.error) {
        registerLoginFailure();
        throw response.error;
      }
      clearThrottleState(LOGIN_THROTTLE_STORAGE_KEY);
      return response.data;
    }

    async function requestPasswordReset(email) {
      assertPasswordResetAllowed();
      const client = deps.requireClient();
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        throw new Error("Informe seu e-mail.");
      }

      const response = await client.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: deps.getPasswordRecoveryRedirectUrl()
      });
      registerPasswordResetCooldown();
      if (response.error) {
        throw new Error("Não foi possível solicitar a recuperação agora. Tente novamente mais tarde.");
      }
      return response.data;
    }

    async function updatePassword(password) {
      const client = deps.requireClient();
      const newPassword = validateNewPassword(password);
      const response = await client.auth.updateUser({ password: newPassword });
      if (response.error) throw response.error;
      return response.data;
    }

    async function changePassword(currentPassword, password) {
      const client = deps.requireClient();
      const current = validateCurrentPassword(currentPassword);
      const newPassword = validateNewPassword(password);
      if (current === newPassword) {
        throw new Error("A nova senha deve ser diferente da senha atual.");
      }

      const response = await client.auth.updateUser({
        password: newPassword,
        currentPassword: current
      });
      if (response.error) throw response.error;
      return response.data;
    }

    async function signInWithGoogle(nextPath) {
      const client = deps.requireClient();
      const response = await client.auth.signInWithOAuth({
        provider: GOOGLE_PROVIDER,
        options: {
          redirectTo: deps.getGoogleRedirectUrl(nextPath),
          queryParams: { prompt: "select_account" }
        }
      });
      if (response.error) throw response.error;
      return response.data;
    }

    async function linkGoogleIdentity() {
      const client = deps.getClient();
      const user = await getUser();
      if (!client || !user) {
        throw new Error("Entre na sua conta antes de vincular o Google.");
      }

      const response = await client.auth.linkIdentity({
        provider: GOOGLE_PROVIDER,
        options: { redirectTo: deps.getGoogleLinkRedirectUrl() }
      });
      if (response.error) throw response.error;
      return response.data;
    }

    async function getUserIdentities() {
      const client = deps.getClient();
      if (!client) return [];
      const response = await client.auth.getUserIdentities();
      if (response.error) throw response.error;
      return response.data && Array.isArray(response.data.identities)
        ? response.data.identities
        : [];
    }

    async function revokeSessions(scope) {
      const client = deps.getClient();
      if (!client) return;
      const response = await client.auth.signOut({ scope: scope });
      if (response.error) throw response.error;
    }

    function revokeAllSessions() {
      return revokeSessions(GLOBAL_SIGN_OUT_SCOPE);
    }

    async function signOutWithScope(scope, allSessions) {
      const suffix = allSessions
        ? "?logged_out=1&all_sessions=1"
        : "?logged_out=1";

      if (!deps.getClient()) {
        window.location.replace(deps.loginPath + suffix);
        return;
      }

      await revokeSessions(scope);
      window.location.replace(deps.loginPath + suffix);
    }

    function signOut() {
      return signOutWithScope(LOCAL_SIGN_OUT_SCOPE, false);
    }

    function signOutEverywhere() {
      return signOutWithScope(GLOBAL_SIGN_OUT_SCOPE, true);
    }

    return Object.freeze({
      getSession: getSession,
      getVerifiedSession: getVerifiedSession,
      getUser: getUser,
      signIn: signIn,
      requestPasswordReset: requestPasswordReset,
      updatePassword: updatePassword,
      changePassword: changePassword,
      signInWithGoogle: signInWithGoogle,
      linkGoogleIdentity: linkGoogleIdentity,
      getUserIdentities: getUserIdentities,
      revokeAllSessions: revokeAllSessions,
      signOut: signOut,
      signOutEverywhere: signOutEverywhere
    });
  }

  window.AuthSessionService = Object.freeze({
    create: create
  });
})();
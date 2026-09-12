(function () {
  "use strict";

  const GOOGLE_PROVIDER = "google";
  const LOCAL_SIGN_OUT_SCOPE = "local";
  const GLOBAL_SIGN_OUT_SCOPE = "global";
  const MIN_PASSWORD_LENGTH = 12;

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

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    async function getSession() {
      const client = deps.getClient();
      if (!client) return null;
      const response = await client.auth.getSession();
      return response && response.data ? response.data.session : null;
    }

    async function getUser() {
      const client = deps.getClient();
      if (!client) return null;
      const response = await client.auth.getUser();
      return response && response.data ? response.data.user : null;
    }

    async function signIn(email, password) {
      const client = deps.requireClient();
      const response = await client.auth.signInWithPassword({
        email: email,
        password: password
      });
      if (response.error) throw response.error;
      return response.data;
    }

    async function requestPasswordReset(email) {
      const client = deps.requireClient();
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        throw new Error("Informe seu e-mail.");
      }

      const response = await client.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: deps.getPasswordRecoveryRedirectUrl()
      });
      if (response.error) throw response.error;
      return response.data;
    }

    async function updatePassword(password) {
      const client = deps.requireClient();
      const newPassword = validateNewPassword(password);
      const response = await client.auth.updateUser({ password: newPassword });
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

    async function signOutWithScope(scope, allSessions) {
      const client = deps.getClient();
      const suffix = allSessions
        ? "?logged_out=1&all_sessions=1"
        : "?logged_out=1";

      if (!client) {
        window.location.replace(deps.loginPath + suffix);
        return;
      }

      const response = await client.auth.signOut({ scope: scope });
      if (response.error) throw response.error;
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
      getUser: getUser,
      signIn: signIn,
      requestPasswordReset: requestPasswordReset,
      updatePassword: updatePassword,
      signInWithGoogle: signInWithGoogle,
      linkGoogleIdentity: linkGoogleIdentity,
      getUserIdentities: getUserIdentities,
      signOut: signOut,
      signOutEverywhere: signOutEverywhere
    });
  }

  window.AuthSessionService = Object.freeze({
    create: create
  });
})();
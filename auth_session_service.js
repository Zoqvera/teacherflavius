(function () {
  "use strict";

  const GOOGLE_PROVIDER = "google";

  function assertDependencies(dependencies) {
    const requiredFunctions = [
      "getClient",
      "requireClient",
      "getGoogleRedirectUrl",
      "getGoogleLinkRedirectUrl"
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

    async function signOut() {
      const client = deps.getClient();
      if (!client) {
        window.location.replace(deps.loginPath + "?logged_out=1");
        return;
      }

      const response = await client.auth.signOut({ scope: "local" });
      if (response.error) throw response.error;
      window.location.replace(deps.loginPath + "?logged_out=1");
    }

    return Object.freeze({
      getSession: getSession,
      getUser: getUser,
      signIn: signIn,
      signInWithGoogle: signInWithGoogle,
      linkGoogleIdentity: linkGoogleIdentity,
      getUserIdentities: getUserIdentities,
      signOut: signOut
    });
  }

  window.AuthSessionService = Object.freeze({
    create: create
  });
})();
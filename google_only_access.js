(function () {
  "use strict";

  if (window.__teacherFlaviusGoogleOnlyAccessLoaded) return;
  window.__teacherFlaviusGoogleOnlyAccessLoaded = true;

  const AUTH_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 30,
    delayMs: 100
  });

  let enforcing = false;

  function isLoginPage() {
    const path = window.location.pathname || "/";
    return path === "/login/" || path.endsWith("/login.html");
  }

  function currentPath() {
    const value = (window.location.pathname || "/") + (window.location.search || "") + (window.location.hash || "");
    return value.startsWith("/") && !value.startsWith("//") ? value : "/area-do-estudante/";
  }

  function authResourcesAreReady() {
    return !!(window.Auth && Auth.getClient && Auth.getSession && Auth.getUserIdentities);
  }

  async function waitForAuth() {
    if (!window.ResourceWaiter) return false;
    return window.ResourceWaiter.waitUntil(authResourcesAreReady, AUTH_WAIT_OPTIONS);
  }

  function disablePasswordSignIn() {
    if (!window.Auth || Auth.__googleOnlyPasswordDisabled) return;
    Auth.__googleOnlyPasswordDisabled = true;
    Auth.signIn = async function () {
      throw new Error("O acesso por e-mail e senha foi desativado. Entre com sua conta Google.");
    };
  }

  function updateProfileIdentityCopy() {
    const status = document.getElementById("googleIdentityStatus");
    const button = document.getElementById("linkGoogleButton");
    if (status) {
      status.classList.add("google-link-success");
      status.textContent = "✓ Conta Google vinculada. O acesso ao portal é feito somente pelo Google.";
    }
    if (button) button.hidden = true;
  }

  async function enforceGoogleOnly() {
    if (enforcing || isLoginPage()) return true;
    if (!(await waitForAuth())) return true;
    disablePasswordSignIn();

    enforcing = true;
    try {
      const session = await Auth.getSession();
      if (!session || !session.user) return true;

      const identities = await Auth.getUserIdentities();
      const hasGoogle = identities.some(function (identity) {
        return identity && identity.provider === "google";
      });

      if (hasGoogle) {
        updateProfileIdentityCopy();
        return true;
      }

      const client = Auth.getClient();
      if (client) {
        try { await client.auth.signOut({ scope: "local" }); } catch (_) {}
      }

      const next = encodeURIComponent(currentPath());
      window.location.replace("/login/?google_required=1&next=" + next);
      return false;
    } catch (error) {
      console.warn("Não foi possível verificar a identidade Google:", error && error.message ? error.message : error);
      return true;
    } finally {
      enforcing = false;
    }
  }

  async function install() {
    if (!(await waitForAuth())) return;
    disablePasswordSignIn();

    if (!isLoginPage()) await enforceGoogleOnly();

    const client = Auth.getClient();
    if (client && client.auth && client.auth.onAuthStateChange) {
      client.auth.onAuthStateChange(function () {
        window.setTimeout(function () { enforceGoogleOnly(); }, 0);
      });
    }

    const observer = new MutationObserver(function () {
      updateProfileIdentityCopy();
      const obsoletePrompt = document.getElementById("teacherGoogleLinkPrompt");
      if (obsoletePrompt && !isLoginPage()) obsoletePrompt.remove();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    updateProfileIdentityCopy();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();

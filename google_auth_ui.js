(function () {
  "use strict";

  const PATHS = Object.freeze({
    studentArea: "/area-do-estudante/",
    login: "/login/",
    onboarding: "/complete-cadastro/",
    profile: "/perfil/"
  });
  const GOOGLE_PROVIDER = "google";
  const RENDERER_MODULE = Object.freeze({
    globalName: "GoogleAuthRenderer",
    selector: 'script[src^="/google_auth_renderer.js"]',
    src: "/google_auth_renderer.js?v=20260902-1",
    missingMessage: "O renderer da autenticação Google não foi inicializado.",
    loadErrorMessage: "Não foi possível carregar o renderer da autenticação Google."
  });

  function isCurrentPath(path) {
    return window.location.pathname === path;
  }

  function getRenderer() {
    if (window.GoogleAuthRenderer) return Promise.resolve(window.GoogleAuthRenderer);

    const moduleLoader = window.ModuleLoader;
    if (!moduleLoader || typeof moduleLoader.loadGlobalModule !== "function") {
      return Promise.reject(new Error("O carregador de módulos não está disponível para a interface Google."));
    }
    return moduleLoader.loadGlobalModule(RENDERER_MODULE);
  }

  async function finishGoogleLogin(renderer) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth") !== GOOGLE_PROVIDER) return;

    try {
      const session = await window.Auth.getSession();
      if (!session || !session.user) {
        throw new Error("Não foi possível concluir o login com Google.");
      }

      const profile = await window.Auth.ensureProfileForUser(session.user);
      const next = window.Auth.normalizeNextPath(params.get("next"), PATHS.studentArea);
      if (!profile || profile.profile_completed !== true) {
        window.location.replace(PATHS.onboarding + "?next=" + encodeURIComponent(next));
        return;
      }
      window.location.replace(next);
    } catch (error) {
      renderer.setErrorMessage(error.message || "Não foi possível concluir o login com Google.");
    }
  }

  function bindGoogleLogin(button, renderer) {
    button.addEventListener("click", async function () {
      const params = new URLSearchParams(window.location.search);
      const next = window.Auth.normalizeNextPath(params.get("next"), PATHS.studentArea);
      renderer.setGoogleLoginBusy(button);

      try {
        await window.Auth.signInWithGoogle(next);
      } catch (error) {
        renderer.resetGoogleButton(button);
        renderer.setErrorMessage(error.message || "Não foi possível iniciar o login com Google.");
      }
    });
  }

  function setupGoogleLoginUi(renderer) {
    if (!isCurrentPath(PATHS.login)) return;
    const form = document.getElementById("loginForm");
    if (!form || document.getElementById("googleLoginBlock")) return;

    const block = renderer.createGoogleLoginBlock();
    form.parentNode.insertBefore(block, form);
    bindGoogleLogin(document.getElementById("googleLoginButton"), renderer);
    finishGoogleLogin(renderer);
  }

  function findGoogleIdentity(identities) {
    return identities.find(function (identity) {
      return identity.provider === GOOGLE_PROVIDER;
    });
  }

  function renderLinkedSuccess(renderer, message, googleIdentity) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_linked") !== "1" || !googleIdentity) return;
    renderer.renderLinkedSuccess(message);
  }

  function bindGoogleLinkButton(button, message, renderer) {
    button.addEventListener("click", async function () {
      renderer.setGoogleLinkBusy(button, message);

      try {
        await window.Auth.linkGoogleIdentity();
      } catch (error) {
        renderer.renderGoogleLinkError(
          button,
          message,
          error.message || "Não foi possível vincular a conta Google."
        );
      }
    });
  }

  async function setupProfileIdentityUi(renderer) {
    if (!isCurrentPath(PATHS.profile)) return;
    const container = document.querySelector(".container");
    if (!container || document.getElementById("googleIdentityCard")) return;

    const card = renderer.createIdentityCard();
    const firstCard = container.querySelector(".card");
    if (firstCard) container.insertBefore(card, firstCard);
    else container.appendChild(card);

    const status = document.getElementById("googleIdentityStatus");
    const button = document.getElementById("linkGoogleButton");
    const message = document.getElementById("googleIdentityMessage");

    try {
      const session = await window.Auth.getSession();
      if (!session) return;

      const identities = await window.Auth.getUserIdentities();
      const googleIdentity = findGoogleIdentity(identities);
      renderer.renderIdentityState(status, button, googleIdentity);
      renderLinkedSuccess(renderer, message, googleIdentity);
    } catch (error) {
      renderer.renderIdentityLoadError(status, message, error.message || "Tente novamente.");
    }

    bindGoogleLinkButton(button, message, renderer);
  }

  async function setupGoogleAuthUi() {
    if (!window.Auth) return;

    try {
      const renderer = await getRenderer();
      setupGoogleLoginUi(renderer);
      setupProfileIdentityUi(renderer);
    } catch (error) {
      console.warn("Não foi possível inicializar a interface de autenticação Google:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupGoogleAuthUi, { once: true });
  } else {
    setupGoogleAuthUi();
  }
})();

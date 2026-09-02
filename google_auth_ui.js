(function () {
  "use strict";

  const PATHS = Object.freeze({
    studentArea: "/area-do-estudante/",
    login: "/login/",
    onboarding: "/complete-cadastro/",
    profile: "/perfil/"
  });
  const GOOGLE_PROVIDER = "google";

  function isCurrentPath(path) {
    return window.location.pathname === path;
  }

  function createElement(tagName, options) {
    const settings = options || {};
    const element = document.createElement(tagName);
    if (settings.id) element.id = settings.id;
    if (settings.className) element.className = settings.className;
    if (settings.text) element.textContent = settings.text;
    return element;
  }

  function setErrorMessage(message) {
    const errorBox = document.getElementById("error");
    if (errorBox) errorBox.textContent = message;
  }

  function createGoogleButton() {
    const button = createElement("button", {
      id: "googleLoginButton",
      className: "google-auth-button"
    });
    button.type = "button";

    const icon = createElement("span", {
      className: "google-auth-g",
      text: "G"
    });
    button.appendChild(icon);
    button.appendChild(document.createTextNode(" CONTINUAR COM GOOGLE"));
    return button;
  }

  function resetGoogleButton(button) {
    button.disabled = false;
    button.textContent = "";
    const icon = createElement("span", {
      className: "google-auth-g",
      text: "G"
    });
    button.appendChild(icon);
    button.appendChild(document.createTextNode(" CONTINUAR COM GOOGLE"));
  }

  function createGoogleLoginBlock() {
    const block = createElement("div", {
      id: "googleLoginBlock",
      className: "google-auth-block"
    });
    const button = createGoogleButton();
    const note = createElement("div", {
      className: "google-auth-note",
      text: "Alunos atuais: para preservar todo o histórico, entre primeiro com seu e-mail e senha e vincule o Google em Meu Perfil."
    });
    const divider = createElement("div", { className: "google-auth-divider" });
    divider.appendChild(createElement("span", { text: "OU" }));

    block.appendChild(button);
    block.appendChild(note);
    block.appendChild(divider);
    return block;
  }

  async function finishGoogleLogin() {
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
      setErrorMessage(error.message || "Não foi possível concluir o login com Google.");
    }
  }

  function bindGoogleLogin(button) {
    button.addEventListener("click", async function () {
      const params = new URLSearchParams(window.location.search);
      const next = window.Auth.normalizeNextPath(params.get("next"), PATHS.studentArea);
      button.disabled = true;
      button.textContent = "ABRINDO GOOGLE...";

      try {
        await window.Auth.signInWithGoogle(next);
      } catch (error) {
        resetGoogleButton(button);
        setErrorMessage(error.message || "Não foi possível iniciar o login com Google.");
      }
    });
  }

  function setupGoogleLoginUi() {
    if (!isCurrentPath(PATHS.login)) return;
    const form = document.getElementById("loginForm");
    if (!form || document.getElementById("googleLoginBlock")) return;

    const block = createGoogleLoginBlock();
    form.parentNode.insertBefore(block, form);
    bindGoogleLogin(document.getElementById("googleLoginButton"));
    finishGoogleLogin();
  }

  function createIdentityCard() {
    const card = createElement("div", {
      id: "googleIdentityCard",
      className: "card"
    });
    card.appendChild(createElement("h2", { text: "Formas de acesso" }));
    card.appendChild(createElement("p", {
      id: "googleIdentityStatus",
      className: "google-link-status",
      text: "Verificando sua conta Google..."
    }));

    const button = createElement("button", {
      id: "linkGoogleButton",
      className: "primary",
      text: "VINCULAR CONTA GOOGLE"
    });
    button.type = "button";
    button.hidden = true;
    card.appendChild(button);
    card.appendChild(createElement("div", {
      id: "googleIdentityMessage",
      className: "message"
    }));
    return card;
  }

  function findGoogleIdentity(identities) {
    return identities.find(function (identity) {
      return identity.provider === GOOGLE_PROVIDER;
    });
  }

  function renderIdentityState(status, button, googleIdentity) {
    if (googleIdentity) {
      status.classList.add("google-link-success");
      status.textContent = "✓ Conta Google vinculada. Você pode entrar com Google ou com seu login atual.";
      button.hidden = true;
      return;
    }

    status.textContent = "Sua conta ainda não está vinculada ao Google.";
    button.hidden = false;
  }

  function renderLinkedSuccess(message, googleIdentity) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_linked") !== "1" || !googleIdentity) return;
    message.className = "message success";
    message.textContent = "Conta Google vinculada com sucesso. Seus dados e seu progresso foram preservados.";
  }

  function bindGoogleLinkButton(button, message) {
    button.addEventListener("click", async function () {
      button.disabled = true;
      button.textContent = "ABRINDO GOOGLE...";
      message.className = "message";
      message.textContent = "";

      try {
        await window.Auth.linkGoogleIdentity();
      } catch (error) {
        button.disabled = false;
        button.textContent = "VINCULAR CONTA GOOGLE";
        message.className = "message error";
        message.textContent = error.message || "Não foi possível vincular a conta Google.";
      }
    });
  }

  async function setupProfileIdentityUi() {
    if (!isCurrentPath(PATHS.profile)) return;
    const container = document.querySelector(".container");
    if (!container || document.getElementById("googleIdentityCard")) return;

    const card = createIdentityCard();
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
      renderIdentityState(status, button, googleIdentity);
      renderLinkedSuccess(message, googleIdentity);
    } catch (error) {
      status.textContent = "Não foi possível verificar as formas de acesso.";
      message.className = "message error";
      message.textContent = error.message || "Tente novamente.";
    }

    bindGoogleLinkButton(button, message);
  }

  function setupGoogleAuthUi() {
    if (!window.Auth) return;
    setupGoogleLoginUi();
    setupProfileIdentityUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupGoogleAuthUi, { once: true });
  } else {
    setupGoogleAuthUi();
  }
})();

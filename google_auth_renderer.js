(function () {
  "use strict";

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

  function appendGoogleButtonContent(button) {
    const icon = createElement("span", {
      className: "google-auth-g",
      text: "G"
    });
    button.appendChild(icon);
    button.appendChild(document.createTextNode(" CONTINUAR COM GOOGLE"));
  }

  function createGoogleButton() {
    const button = createElement("button", {
      id: "googleLoginButton",
      className: "google-auth-button"
    });
    button.type = "button";
    appendGoogleButtonContent(button);
    return button;
  }

  function setGoogleLoginBusy(button) {
    button.disabled = true;
    button.textContent = "ABRINDO GOOGLE...";
  }

  function resetGoogleButton(button) {
    button.disabled = false;
    button.textContent = "";
    appendGoogleButtonContent(button);
  }

  function createGoogleLoginBlock() {
    const block = createElement("div", {
      id: "googleLoginBlock",
      className: "google-auth-block"
    });
    const note = createElement("div", {
      className: "google-auth-note",
      text: "Alunos atuais: para preservar todo o histórico, entre primeiro com seu e-mail e senha e vincule o Google em Meu Perfil."
    });
    const divider = createElement("div", { className: "google-auth-divider" });

    divider.appendChild(createElement("span", { text: "OU" }));
    block.appendChild(createGoogleButton());
    block.appendChild(note);
    block.appendChild(divider);
    return block;
  }

  function createIdentityCard() {
    const card = createElement("div", {
      id: "googleIdentityCard",
      className: "card"
    });
    const button = createElement("button", {
      id: "linkGoogleButton",
      className: "primary",
      text: "VINCULAR CONTA GOOGLE"
    });

    button.type = "button";
    button.hidden = true;
    card.appendChild(createElement("h2", { text: "Formas de acesso" }));
    card.appendChild(createElement("p", {
      id: "googleIdentityStatus",
      className: "google-link-status",
      text: "Verificando sua conta Google..."
    }));
    card.appendChild(button);
    card.appendChild(createElement("div", {
      id: "googleIdentityMessage",
      className: "message"
    }));
    return card;
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

  function renderLinkedSuccess(message) {
    message.className = "message success";
    message.textContent = "Conta Google vinculada com sucesso. Seus dados e seu progresso foram preservados.";
  }

  function setGoogleLinkBusy(button, message) {
    button.disabled = true;
    button.textContent = "ABRINDO GOOGLE...";
    message.className = "message";
    message.textContent = "";
  }

  function renderGoogleLinkError(button, message, errorMessage) {
    button.disabled = false;
    button.textContent = "VINCULAR CONTA GOOGLE";
    message.className = "message error";
    message.textContent = errorMessage;
  }

  function renderIdentityLoadError(status, message, errorMessage) {
    status.textContent = "Não foi possível verificar as formas de acesso.";
    message.className = "message error";
    message.textContent = errorMessage;
  }

  window.GoogleAuthRenderer = Object.freeze({
    setErrorMessage: setErrorMessage,
    createGoogleLoginBlock: createGoogleLoginBlock,
    setGoogleLoginBusy: setGoogleLoginBusy,
    resetGoogleButton: resetGoogleButton,
    createIdentityCard: createIdentityCard,
    renderIdentityState: renderIdentityState,
    renderLinkedSuccess: renderLinkedSuccess,
    setGoogleLinkBusy: setGoogleLinkBusy,
    renderGoogleLinkError: renderGoogleLinkError,
    renderIdentityLoadError: renderIdentityLoadError
  });
})();

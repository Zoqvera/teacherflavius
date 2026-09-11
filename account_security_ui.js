(function (root) {
  "use strict";

  const CARD_ID = "accountSecurityCard";
  const BUTTON_ID = "signOutEverywhereButton";
  const MESSAGE_ID = "accountSecurityMessage";

  function createElement(documentRef, tagName, className, text) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function buildCard(documentRef) {
    const card = createElement(documentRef, "section", "card");
    card.id = CARD_ID;
    card.setAttribute("aria-labelledby", "accountSecurityTitle");

    const title = createElement(documentRef, "h2", "", "Segurança da conta");
    title.id = "accountSecurityTitle";
    const description = createElement(
      documentRef,
      "p",
      "privacy-copy",
      "O botão SAIR encerra apenas esta sessão. A opção abaixo revoga as sessões renováveis em todos os dispositivos; tokens de acesso já emitidos podem permanecer válidos até expirarem."
    );
    const button = createElement(
      documentRef,
      "button",
      "privacy-danger",
      "SAIR DE TODOS OS DISPOSITIVOS"
    );
    button.id = BUTTON_ID;
    button.type = "button";

    const message = createElement(documentRef, "div", "message", "");
    message.id = MESSAGE_ID;
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(button);
    card.appendChild(message);
    return card;
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.textContent = busy
      ? "ENCERRANDO SESSÕES..."
      : "SAIR DE TODOS OS DISPOSITIVOS";
  }

  function setError(message, error) {
    if (!message) return;
    message.className = "message error";
    message.textContent = error && error.message
      ? error.message
      : "Não foi possível encerrar as sessões. Tente novamente.";
  }

  async function signOutEverywhere(windowRef, documentRef) {
    const button = documentRef.getElementById(BUTTON_ID);
    const message = documentRef.getElementById(MESSAGE_ID);
    const auth = windowRef.Auth;
    if (!button || !auth || typeof auth.signOutEverywhere !== "function") return;

    const confirmed = windowRef.confirm(
      "Revogar as sessões renováveis neste navegador e nos outros dispositivos vinculados à sua conta?"
    );
    if (!confirmed) return;

    setBusy(button, true);
    if (message) message.textContent = "";

    try {
      await auth.signOutEverywhere();
    } catch (error) {
      setError(message, error);
      setBusy(button, false);
    }
  }

  function placeCard(documentRef, card, container) {
    const privacyTitle = documentRef.getElementById("privacyTitle");
    const privacySection = privacyTitle && privacyTitle.closest
      ? privacyTitle.closest("section")
      : null;

    if (privacySection && privacySection.parentNode === container) {
      container.insertBefore(card, privacySection);
      return;
    }
    container.appendChild(card);
  }

  function initialize(options) {
    const settings = options || {};
    const windowRef = settings.windowRef || root;
    const documentRef = settings.documentRef || (windowRef && windowRef.document);
    if (!windowRef || !documentRef || windowRef.location.pathname !== "/perfil/") return false;
    if (documentRef.getElementById(CARD_ID)) return true;

    const container = documentRef.querySelector(".container");
    if (!container) return false;

    const card = buildCard(documentRef);
    placeCard(documentRef, card, container);

    const button = documentRef.getElementById(BUTTON_ID);
    button.addEventListener("click", function () {
      signOutEverywhere(windowRef, documentRef);
    });
    return true;
  }

  const api = Object.freeze({
    initialize: initialize,
    signOutEverywhere: signOutEverywhere
  });
  if (root) root.AccountSecurityUi = api;

  if (root && root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener(
        "DOMContentLoaded",
        function () { initialize(); },
        { once: true }
      );
    } else {
      initialize();
    }
  }
})(typeof window !== "undefined" ? window : null);

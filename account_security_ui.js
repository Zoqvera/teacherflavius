(function (root) {
  "use strict";

  const CARD_ID = "accountSecurityCard";
  const BUTTON_ID = "signOutEverywhereButton";
  const MESSAGE_ID = "accountSecurityMessage";
  const PASSWORD_SECTION_ID = "passwordChangeSection";
  const PASSWORD_FORM_ID = "passwordChangeForm";
  const PASSWORD_MESSAGE_ID = "passwordChangeMessage";
  const MIN_PASSWORD_LENGTH = 12;
  const LOGIN_PATH = "/login/?password_access=1&password_updated=1&all_sessions=1";

  function createElement(documentRef, tagName, className, text) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function buildPasswordField(documentRef, options) {
    const settings = options || {};
    const wrapper = createElement(documentRef, "div", "account-security-field");
    const label = createElement(documentRef, "label", "", settings.label);
    label.htmlFor = settings.id;

    const input = createElement(documentRef, "input");
    input.id = settings.id;
    input.type = "password";
    input.autocomplete = settings.autocomplete;
    input.required = true;
    if (settings.minimumLength) input.minLength = settings.minimumLength;

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return Object.freeze({ wrapper: wrapper, input: input });
  }

  function buildPasswordSection(documentRef) {
    const section = createElement(documentRef, "div", "", "");
    section.id = PASSWORD_SECTION_ID;
    section.hidden = true;

    const heading = createElement(documentRef, "h3", "", "Alterar senha");
    const description = createElement(
      documentRef,
      "p",
      "privacy-copy",
      "Para alterar a senha, confirme a senha atual. Depois da alteração, as sessões renováveis em todos os dispositivos serão encerradas."
    );
    const form = createElement(documentRef, "form");
    form.id = PASSWORD_FORM_ID;
    form.noValidate = true;

    const current = buildPasswordField(documentRef, {
      id: "accountCurrentPassword",
      label: "Senha atual",
      autocomplete: "current-password"
    });
    const next = buildPasswordField(documentRef, {
      id: "accountNewPassword",
      label: "Nova senha",
      autocomplete: "new-password",
      minimumLength: MIN_PASSWORD_LENGTH
    });
    const confirmation = buildPasswordField(documentRef, {
      id: "accountConfirmPassword",
      label: "Confirmar nova senha",
      autocomplete: "new-password",
      minimumLength: MIN_PASSWORD_LENGTH
    });

    const submit = createElement(documentRef, "button", "primary", "ALTERAR SENHA");
    submit.type = "submit";

    const message = createElement(documentRef, "div", "message", "");
    message.id = PASSWORD_MESSAGE_ID;
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    form.appendChild(current.wrapper);
    form.appendChild(next.wrapper);
    form.appendChild(confirmation.wrapper);
    form.appendChild(submit);
    form.appendChild(message);
    section.appendChild(heading);
    section.appendChild(description);
    section.appendChild(form);

    return Object.freeze({
      section: section,
      form: form,
      currentInput: current.input,
      newInput: next.input,
      confirmationInput: confirmation.input,
      submitButton: submit,
      message: message
    });
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
    const passwordView = buildPasswordSection(documentRef);
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
    card.appendChild(passwordView.section);
    card.appendChild(button);
    card.appendChild(message);
    return Object.freeze({ card: card, passwordView: passwordView });
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.textContent = busy
      ? "ENCERRANDO SESSÕES..."
      : "SAIR DE TODOS OS DISPOSITIVOS";
  }

  function setPasswordBusy(view, busy) {
    view.currentInput.disabled = busy;
    view.newInput.disabled = busy;
    view.confirmationInput.disabled = busy;
    view.submitButton.disabled = busy;
    view.submitButton.textContent = busy ? "ALTERANDO..." : "ALTERAR SENHA";
  }

  function setError(message, error) {
    if (!message) return;
    message.className = "message error";
    message.textContent = error && error.message
      ? error.message
      : "Não foi possível encerrar as sessões. Tente novamente.";
  }

  function setPasswordError(message, text) {
    message.className = "message error";
    message.textContent = text;
  }

  function validatePasswordChange(view) {
    const currentPassword = view.currentInput.value;
    const newPassword = view.newInput.value;
    const confirmation = view.confirmationInput.value;

    if (!currentPassword) {
      return { error: "Informe sua senha atual." };
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { error: "A nova senha deve ter pelo menos " + MIN_PASSWORD_LENGTH + " caracteres." };
    }
    if (newPassword !== confirmation) {
      return { error: "A confirmação da nova senha não coincide." };
    }
    if (currentPassword === newPassword) {
      return { error: "A nova senha deve ser diferente da senha atual." };
    }
    return { currentPassword: currentPassword, newPassword: newPassword };
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

  async function canChangePassword(auth) {
    if (!auth || typeof auth.getUser !== "function" ||
        typeof auth.getUserIdentities !== "function" ||
        typeof auth.isPasswordAccessAllowedUser !== "function") return false;

    const user = await auth.getUser();
    if (!auth.isPasswordAccessAllowedUser(user)) return false;
    const identities = await auth.getUserIdentities();
    return identities.some(function (identity) {
      return identity && identity.provider === "email";
    });
  }

  async function submitPasswordChange(windowRef, view) {
    const auth = windowRef.Auth;
    const validation = validatePasswordChange(view);
    view.message.className = "message";
    view.message.textContent = "";

    if (validation.error) {
      setPasswordError(view.message, validation.error);
      return;
    }
    if (!auth || typeof auth.changePassword !== "function" ||
        typeof auth.revokeAllSessions !== "function") {
      setPasswordError(view.message, "O serviço de alteração de senha não está disponível.");
      return;
    }

    setPasswordBusy(view, true);
    let passwordChanged = false;
    try {
      await auth.changePassword(validation.currentPassword, validation.newPassword);
      passwordChanged = true;
      await auth.revokeAllSessions();
      windowRef.location.replace(LOGIN_PATH);
    } catch (_) {
      const message = passwordChanged
        ? "A senha foi alterada, mas não foi possível encerrar todas as sessões. Use a opção SAIR DE TODOS OS DISPOSITIVOS antes de continuar."
        : "Não foi possível alterar a senha. Confirme a senha atual e tente novamente.";
      setPasswordError(view.message, message);
      view.currentInput.value = "";
      view.newInput.value = "";
      view.confirmationInput.value = "";
      setPasswordBusy(view, false);
    }
  }

  async function initializePasswordChange(windowRef, view) {
    try {
      if (!(await canChangePassword(windowRef.Auth))) return;
      view.section.hidden = false;
      view.form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitPasswordChange(windowRef, view);
      });
    } catch (_) {
      view.section.hidden = true;
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

    const cardView = buildCard(documentRef);
    placeCard(documentRef, cardView.card, container);

    const button = documentRef.getElementById(BUTTON_ID);
    button.addEventListener("click", function () {
      signOutEverywhere(windowRef, documentRef);
    });
    initializePasswordChange(windowRef, cardView.passwordView);
    return true;
  }

  const api = Object.freeze({
    initialize: initialize,
    signOutEverywhere: signOutEverywhere,
    submitPasswordChange: submitPasswordChange,
    validatePasswordChange: validatePasswordChange
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

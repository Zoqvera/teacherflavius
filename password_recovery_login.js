(function () {
  "use strict";

  const LOGIN_PATH = "/login/";
  const PASSWORD_RECOVERY_PATH = "/recuperar-senha/";
  const MIN_PASSWORD_LENGTH = 8;
  const SESSION_WAIT_ATTEMPTS = 40;
  const SESSION_WAIT_DELAY_MS = 100;

  function hasRecoveryMarker() {
    const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    return hash.get("type") === "recovery";
  }

  function createLink(text, href) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    return link;
  }

  function installForgotPasswordLink() {
    const form = document.getElementById("passwordLoginForm");
    if (!form || document.getElementById("forgotPasswordLink")) return;

    const wrapper = document.createElement("p");
    wrapper.className = "password-recovery-link";

    const link = createLink("Esqueci minha senha", PASSWORD_RECOVERY_PATH);
    link.id = "forgotPasswordLink";
    wrapper.appendChild(link);
    form.appendChild(wrapper);
  }

  function showPasswordUpdatedNotice() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("password_updated") !== "1") return;

    const error = document.getElementById("loginError");
    if (!error) return;
    error.classList.add("password-recovery-success");
    error.textContent = "Senha atualizada. Entre novamente com a nova senha.";
  }

  function buildField(labelText, inputId, autocomplete) {
    const wrapper = document.createElement("div");
    wrapper.className = "password-recovery-field";

    const label = document.createElement("label");
    label.htmlFor = inputId;
    label.textContent = labelText;

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "password";
    input.autocomplete = autocomplete;
    input.required = true;
    input.minLength = MIN_PASSWORD_LENGTH;

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return { wrapper: wrapper, input: input };
  }

  function buildRecoveryPanel() {
    const overlay = document.createElement("div");
    overlay.className = "password-recovery-overlay";

    const panel = document.createElement("main");
    panel.className = "password-recovery-panel";
    panel.setAttribute("aria-labelledby", "passwordRecoveryTitle");

    const badge = document.createElement("span");
    badge.className = "password-recovery-badge";
    badge.textContent = "TEACHER FLÁVIO";

    const title = document.createElement("h1");
    title.id = "passwordRecoveryTitle";
    title.textContent = "Criar nova senha";

    const intro = document.createElement("p");
    intro.textContent = "Defina uma nova senha para sua conta.";

    const form = document.createElement("form");
    form.id = "passwordRecoveryUpdateForm";
    form.noValidate = true;

    const passwordField = buildField("Nova senha", "newPassword", "new-password");
    const confirmationField = buildField("Confirmar nova senha", "confirmNewPassword", "new-password");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "ATUALIZAR SENHA";

    const status = document.createElement("div");
    status.id = "passwordRecoveryStatus";
    status.className = "password-recovery-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const back = createLink("VOLTAR AO LOGIN", LOGIN_PATH + "?password_access=1");
    back.className = "password-recovery-back";

    form.appendChild(passwordField.wrapper);
    form.appendChild(confirmationField.wrapper);
    form.appendChild(submit);
    form.appendChild(status);

    panel.appendChild(badge);
    panel.appendChild(title);
    panel.appendChild(intro);
    panel.appendChild(form);
    panel.appendChild(back);
    overlay.appendChild(panel);

    return {
      overlay: overlay,
      form: form,
      passwordInput: passwordField.input,
      confirmationInput: confirmationField.input,
      submitButton: submit,
      status: status
    };
  }

  function setBusy(view, busy) {
    view.passwordInput.disabled = busy;
    view.confirmationInput.disabled = busy;
    view.submitButton.disabled = busy;
    view.submitButton.textContent = busy ? "ATUALIZANDO..." : "ATUALIZAR SENHA";
  }

  async function waitForRecoverySession() {
    if (!window.Auth || typeof Auth.getSession !== "function") return null;

    for (let attempt = 0; attempt < SESSION_WAIT_ATTEMPTS; attempt += 1) {
      const session = await Auth.getSession();
      if (session && session.user) return session;
      await new Promise(function (resolve) {
        window.setTimeout(resolve, SESSION_WAIT_DELAY_MS);
      });
    }

    return null;
  }

  async function updatePassword(view) {
    const password = view.passwordInput.value;
    const confirmation = view.confirmationInput.value;

    if (password.length < MIN_PASSWORD_LENGTH) {
      view.status.textContent = "A senha deve ter pelo menos 8 caracteres.";
      return;
    }

    if (password !== confirmation) {
      view.status.textContent = "As senhas informadas não coincidem.";
      return;
    }

    setBusy(view, true);
    view.status.textContent = "";

    try {
      const session = await waitForRecoverySession();
      if (!session) {
        throw new Error("O link de recuperação expirou ou já foi utilizado.");
      }

      await Auth.updatePassword(password);
      const client = Auth.getClient();
      if (client) await client.auth.signOut({ scope: "local" });
      window.location.replace(LOGIN_PATH + "?password_access=1&password_updated=1");
    } catch (error) {
      view.status.textContent = error && error.message
        ? error.message
        : "Não foi possível atualizar a senha. Solicite um novo link.";
      setBusy(view, false);
    }
  }

  function installRecoveryPanel() {
    if (!hasRecoveryMarker() || document.querySelector(".password-recovery-overlay")) return;

    const view = buildRecoveryPanel();
    document.body.appendChild(view.overlay);
    document.documentElement.classList.add("password-recovery-active");
    document.title = "Criar nova senha - Teacher Flávio";

    view.form.addEventListener("submit", function (event) {
      event.preventDefault();
      updatePassword(view);
    });

    view.passwordInput.focus();
  }

  function initialize() {
    installForgotPasswordLink();
    showPasswordUpdatedNotice();
    installRecoveryPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

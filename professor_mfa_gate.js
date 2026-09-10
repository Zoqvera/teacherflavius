(function () {
  "use strict";

  const GATE_ID = "professorMfaGate";
  const BODY_CLASS = "professor-mfa-required";

  function requireServiceModule() {
    if (!window.ProfessorMfaService || typeof window.ProfessorMfaService.create !== "function") {
      throw new Error("O serviço de autenticação em duas etapas não foi carregado.");
    }
    return window.ProfessorMfaService;
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function createButton(label, className) {
    const button = createElement("button", className, label);
    button.type = "button";
    return button;
  }

  function clearChildren(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function setBusy(button, busy, busyLabel, idleLabel) {
    button.disabled = busy;
    button.textContent = busy ? busyLabel : idleLabel;
  }

  function normalizeErrorMessage(error) {
    const message = String((error && error.message) || "").trim();
    if (!message) return "Não foi possível concluir a autenticação em duas etapas.";
    if (/invalid.*code|invalid.*totp|challenge/i.test(message)) {
      return "Código inválido ou expirado. Consulte o aplicativo autenticador e tente novamente.";
    }
    return message;
  }

  function buildShell() {
    const existing = document.getElementById(GATE_ID);
    if (existing) existing.remove();

    const overlay = createElement("section", "professor-mfa-overlay");
    overlay.id = GATE_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "professorMfaTitle");

    const panel = createElement("div", "professor-mfa-panel");
    const badge = createElement("span", "professor-mfa-badge", "SEGURANÇA ADMINISTRATIVA");
    const title = createElement("h2", "professor-mfa-title", "Verificação em duas etapas");
    title.id = "professorMfaTitle";
    const description = createElement(
      "p",
      "professor-mfa-description",
      "A Área do Professor exige um segundo fator de autenticação antes de liberar dados e operações administrativas."
    );
    const content = createElement("div", "professor-mfa-content");
    const error = createElement("p", "professor-mfa-error");
    error.setAttribute("role", "alert");
    const actions = createElement("div", "professor-mfa-secondary-actions");
    const signOut = createButton("SAIR DA CONTA", "professor-mfa-link-button");

    signOut.addEventListener("click", function () {
      signOut.disabled = true;
      if (window.Auth && typeof window.Auth.signOut === "function") {
        window.Auth.signOut().catch(function () {
          signOut.disabled = false;
        });
      }
    });

    actions.appendChild(signOut);
    panel.appendChild(badge);
    panel.appendChild(title);
    panel.appendChild(description);
    panel.appendChild(content);
    panel.appendChild(error);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.body.classList.add(BODY_CLASS);

    return Object.freeze({
      overlay: overlay,
      content: content,
      error: error
    });
  }

  function closeShell(shell) {
    if (shell && shell.overlay) shell.overlay.remove();
    document.body.classList.remove(BODY_CLASS);
  }

  function createCodeForm(options) {
    const settings = options || {};
    const wrapper = createElement("div", "professor-mfa-code-form");
    const label = createElement("label", "professor-mfa-label", "Código do autenticador");
    const input = createElement("input", "professor-mfa-code-input");
    const button = createButton(settings.buttonLabel || "VERIFICAR CÓDIGO", "professor-mfa-primary-button");

    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.maxLength = 6;
    input.placeholder = "000000";
    input.setAttribute("aria-label", "Código de 6 dígitos do aplicativo autenticador");
    label.appendChild(input);
    wrapper.appendChild(label);
    wrapper.appendChild(button);

    function submit() {
      settings.onSubmit(input.value, button, input);
    }

    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });

    return Object.freeze({
      element: wrapper,
      input: input,
      button: button
    });
  }

  function renderExistingFactor(shell, service, factor, resolve) {
    clearChildren(shell.content);
    shell.error.textContent = "";

    shell.content.appendChild(createElement(
      "p",
      "professor-mfa-instruction",
      "Abra o aplicativo autenticador vinculado à sua conta e informe o código atual de 6 dígitos."
    ));

    const form = createCodeForm({
      buttonLabel: "VERIFICAR CÓDIGO",
      onSubmit: async function (code, button, input) {
        setBusy(button, true, "VERIFICANDO...", "VERIFICAR CÓDIGO");
        shell.error.textContent = "";
        try {
          await service.verifyFactor(factor.id, code);
          closeShell(shell);
          resolve(true);
        } catch (error) {
          shell.error.textContent = normalizeErrorMessage(error);
          input.value = "";
          input.focus();
          setBusy(button, false, "VERIFICANDO...", "VERIFICAR CÓDIGO");
        }
      }
    });

    shell.content.appendChild(form.element);
    window.setTimeout(function () { form.input.focus(); }, 0);
  }

  function renderEnrollmentDetails(shell, service, enrollment, resolve) {
    clearChildren(shell.content);
    shell.error.textContent = "";

    shell.content.appendChild(createElement(
      "p",
      "professor-mfa-instruction",
      "Escaneie o QR code em um aplicativo autenticador, como Google Authenticator, Microsoft Authenticator ou 1Password."
    ));

    const qr = createElement("img", "professor-mfa-qr");
    qr.src = enrollment.totp.qr_code;
    qr.alt = "QR code para configurar a autenticação em duas etapas";
    shell.content.appendChild(qr);

    const secretLabel = createElement("p", "professor-mfa-secret-label", "Se não conseguir escanear, use esta chave:");
    const secret = createElement("code", "professor-mfa-secret", enrollment.totp.secret);
    shell.content.appendChild(secretLabel);
    shell.content.appendChild(secret);

    const form = createCodeForm({
      buttonLabel: "ATIVAR E CONTINUAR",
      onSubmit: async function (code, button, input) {
        setBusy(button, true, "ATIVANDO...", "ATIVAR E CONTINUAR");
        shell.error.textContent = "";
        try {
          await service.verifyFactor(enrollment.id, code);
          closeShell(shell);
          resolve(true);
        } catch (error) {
          shell.error.textContent = normalizeErrorMessage(error);
          input.value = "";
          input.focus();
          setBusy(button, false, "ATIVANDO...", "ATIVAR E CONTINUAR");
        }
      }
    });

    shell.content.appendChild(form.element);
  }

  function renderEnrollmentStart(shell, service, resolve) {
    clearChildren(shell.content);
    shell.error.textContent = "";

    shell.content.appendChild(createElement(
      "p",
      "professor-mfa-instruction",
      "Esta conta administrativa ainda não possui um autenticador configurado. A configuração é obrigatória para continuar."
    ));

    const button = createButton("CONFIGURAR AUTENTICADOR", "professor-mfa-primary-button");
    button.addEventListener("click", async function () {
      setBusy(button, true, "PREPARANDO...", "CONFIGURAR AUTENTICADOR");
      shell.error.textContent = "";
      try {
        const enrollment = await service.enrollTotp();
        renderEnrollmentDetails(shell, service, enrollment, resolve);
      } catch (error) {
        shell.error.textContent = normalizeErrorMessage(error);
        setBusy(button, false, "PREPARANDO...", "CONFIGURAR AUTENTICADOR");
      }
    });
    shell.content.appendChild(button);
  }

  async function requireAal2(options) {
    const settings = options || {};
    const serviceModule = requireServiceModule();
    const service = serviceModule.create({
      getClient: function () { return settings.client; }
    });
    const state = await service.getState();

    if (state.status === "verified") return true;

    const shell = buildShell();
    return new Promise(function (resolve) {
      if (state.status === "challenge" && state.factor) {
        renderExistingFactor(shell, service, state.factor, resolve);
        return;
      }
      renderEnrollmentStart(shell, service, resolve);
    });
  }

  window.ProfessorMfaGate = Object.freeze({
    requireAal2: requireAal2
  });
})();

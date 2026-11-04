(function (root) {
  "use strict";

  const CARD_ID = "teacherMfaSetupCard";
  const TOTP_PATTERN = /^[0-9]{6}$/;

  function requireData(response, fallbackMessage) {
    if (!response || response.error || !response.data) {
      throw new Error(fallbackMessage);
    }
    return response.data;
  }

  function createController(options) {
    const dependencies = options || {};
    if (typeof dependencies.getClient !== "function" ||
        typeof dependencies.isTeacherAdmin !== "function") {
      throw new Error("Dependências do segundo fator não configuradas.");
    }

    let pendingFactorId = null;

    function getMfaClient() {
      const client = dependencies.getClient();
      if (!client || !client.auth || !client.auth.mfa) {
        throw new Error("Serviço de autenticação não disponível.");
      }
      return client.auth.mfa;
    }

    async function readFactors() {
      return requireData(
        await getMfaClient().listFactors(),
        "Não foi possível consultar os fatores da conta."
      );
    }

    async function getStatus() {
      if (!(await dependencies.isTeacherAdmin())) {
        return Object.freeze({ allowed: false });
      }

      const mfa = getMfaClient();
      const factors = await readFactors();
      const assurance = requireData(
        await mfa.getAuthenticatorAssuranceLevel(),
        "Não foi possível verificar o nível da sessão."
      );
      const verified = (factors.totp || []).find(
        factor => factor.status === "verified"
      );

      return Object.freeze({
        allowed: true,
        enrolled: Boolean(verified),
        verified: assurance.currentLevel === "aal2"
      });
    }

    async function beginEnrollment() {
      const status = await getStatus();
      if (!status.allowed || status.enrolled) {
        throw new Error("A configuração de um novo fator não está disponível.");
      }

      const mfa = getMfaClient();
      const factors = await readFactors();
      const unverified = (factors.totp || []).filter(
        factor => factor.status === "unverified"
      );

      for (const factor of unverified) {
        requireData(
          await mfa.unenroll({ factorId: factor.id }),
          "Não foi possível limpar uma configuração anterior."
        );
      }

      const enrollment = requireData(
        await mfa.enroll({
          factorType: "totp",
          friendlyName: "Teacher Flávio"
        }),
        "Não foi possível iniciar o segundo fator."
      );

      if (!enrollment.id || !enrollment.totp || !enrollment.totp.secret) {
        throw new Error("O autenticador não retornou os dados necessários.");
      }
      pendingFactorId = enrollment.id;

      // The secret only exists in memory while the user configures the factor.
      return Object.freeze({
        secret: enrollment.totp.secret,
        qrCode: enrollment.totp.qr_code || ""
      });
    }

    async function verifyCode(value) {
      const code = String(value || "").trim();
      if (!TOTP_PATTERN.test(code)) {
        throw new Error("Informe o código de seis dígitos do autenticador.");
      }

      const status = await getStatus();
      if (!status.allowed) {
        throw new Error("Acesso administrativo necessário.");
      }

      let factorId = pendingFactorId;
      if (!factorId) {
        const factors = await readFactors();
        const verifiedFactor = (factors.totp || []).find(
          factor => factor.status === "verified"
        );
        if (!verifiedFactor) {
          throw new Error("Configure o autenticador antes de confirmar o código.");
        }
        factorId = verifiedFactor.id;
      }

      const mfa = getMfaClient();
      const challenge = requireData(
        await mfa.challenge({ factorId }),
        "Não foi possível solicitar a verificação."
      );
      requireData(
        await mfa.verify({ factorId, challengeId: challenge.id, code }),
        "Código inválido ou expirado. Confira o aplicativo autenticador."
      );
      pendingFactorId = null;
      return getStatus();
    }

    return Object.freeze({ getStatus, beginEnrollment, verifyCode });
  }

  function addElement(documentRef, parent, tagName, options) {
    const config = options || {};
    const element = documentRef.createElement(tagName);
    if (config.className) element.className = config.className;
    if (config.text) element.textContent = config.text;
    if (config.id) element.id = config.id;
    parent.appendChild(element);
    return element;
  }

  function createView(documentRef, container) {
    const card = addElement(documentRef, container, "section", {
      id: CARD_ID, className: "card"
    });
    addElement(documentRef, card, "h2", {
      text: "Autenticação em duas etapas do professor"
    });
    addElement(documentRef, card, "p", {
      className: "privacy-copy",
      text: "Configure um aplicativo autenticador para proteger futuras operações administrativas sensíveis. A exigência obrigatória ainda não foi ativada."
    });
    const status = addElement(documentRef, card, "p", {
      id: "teacherMfaStatus"
    });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const start = addElement(documentRef, card, "button", {
      text: "CONFIGURAR APLICATIVO AUTENTICADOR"
    });
    start.type = "button";

    const setup = addElement(documentRef, card, "div");
    setup.hidden = true;
    addElement(documentRef, setup, "p", {
      text: "Leia o código QR com seu autenticador ou digite a chave abaixo. Não compartilhe essa chave."
    });
    const qr = addElement(documentRef, setup, "img");
    qr.alt = "Código QR para configurar o segundo fator";
    qr.width = 180;
    qr.height = 180;
    qr.hidden = true;
    const secret = addElement(documentRef, setup, "code");

    const form = addElement(documentRef, card, "form");
    form.hidden = true;
    const inputLabel = addElement(documentRef, form, "label", {
      text: "Código de seis dígitos"
    });
    inputLabel.htmlFor = "teacherMfaCode";
    const input = addElement(documentRef, form, "input", {
      id: "teacherMfaCode"
    });
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.required = true;
    input.maxLength = 6;
    input.pattern = "[0-9]{6}";
    const submit = addElement(documentRef, form, "button", {
      text: "CONFIRMAR CÓDIGO"
    });
    submit.type = "submit";

    return Object.freeze({
      card, status, start, setup, qr, secret, form, input, submit
    });
  }

  function updateView(view, status) {
    view.setup.hidden = true;
    view.secret.textContent = "";
    view.qr.removeAttribute("src");
    view.qr.hidden = true;
    view.start.hidden = status.enrolled;
    view.form.hidden = !status.enrolled || status.verified;
    view.status.textContent = status.verified
      ? "Segundo fator confirmado nesta sessão (AAL2)."
      : status.enrolled
        ? "Autenticador configurado. Confirme o código para elevar a segurança desta sessão."
        : "Nenhum aplicativo autenticador verificado nesta conta.";
  }

  async function initialize(options) {
    const settings = options || {};
    const windowRef = settings.windowRef || root;
    const documentRef = settings.documentRef ||
      (windowRef && windowRef.document);

    if (!windowRef || !documentRef ||
        windowRef.location.pathname !== "/perfil/" ||
        documentRef.getElementById(CARD_ID)) {
      return false;
    }

    const auth = windowRef.Auth;
    const container = documentRef.querySelector(".container");
    if (!auth || !container || typeof auth.getClient !== "function" ||
        typeof auth.isTeacherAdmin !== "function") {
      return false;
    }

    const controller = createController({
      getClient: auth.getClient,
      isTeacherAdmin: auth.isTeacherAdmin
    });
    let initialStatus;
    try {
      initialStatus = await controller.getStatus();
    } catch (_) {
      return false;
    }
    if (!initialStatus.allowed || documentRef.getElementById(CARD_ID)) {
      return false;
    }

    const view = createView(documentRef, container);
    updateView(view, initialStatus);

    async function perform(action) {
      view.start.disabled = true;
      view.submit.disabled = true;
      view.status.textContent = "Verificando...";
      try {
        await action();
      } catch (error) {
        view.status.textContent = error.message ||
          "Não foi possível concluir a operação.";
      } finally {
        view.start.disabled = false;
        view.submit.disabled = false;
      }
    }

    view.start.addEventListener("click", () => perform(async () => {
      const enrollment = await controller.beginEnrollment();
      view.setup.hidden = false;
      view.secret.textContent = enrollment.secret;
      if (/^data:image\/svg\+xml(?:;|,)/i.test(enrollment.qrCode)) {
        view.qr.src = enrollment.qrCode;
        view.qr.hidden = false;
      }
      view.start.hidden = true;
      view.form.hidden = false;
      view.status.textContent = "Digite o código do aplicativo para concluir a configuração.";
    }));

    view.form.addEventListener("submit", event => {
      event.preventDefault();
      const code = view.input.value;
      view.input.value = "";
      perform(async () => {
        const status = await controller.verifyCode(code);
        updateView(view, status);
      });
    });

    return true;
  }

  const api = Object.freeze({ createController, initialize });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TeacherMfaSetup = api;

  if (root && root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => {
        initialize().catch(() => {});
      }, { once: true });
    } else {
      initialize().catch(() => {});
    }
  }
})(typeof window !== "undefined" ? window : null);

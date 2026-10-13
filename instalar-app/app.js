(function () {
  "use strict";

  const BUTTON_ID = "installAppButton";
  const STATUS_ID = "installStatus";
  const INSTRUCTIONS_ID = "manualInstructions";
  const INSTRUCTIONS_TEXT_ID = "manualInstructionsText";

  function elements(documentRef) {
    return {
      button: documentRef.getElementById(BUTTON_ID),
      status: documentRef.getElementById(STATUS_ID),
      instructions: documentRef.getElementById(INSTRUCTIONS_ID),
      instructionsText: documentRef.getElementById(INSTRUCTIONS_TEXT_ID)
    };
  }

  function isIos(windowRef) {
    const navigatorRef = windowRef.navigator || {};
    return /iphone|ipad|ipod/i.test(navigatorRef.userAgent || "") ||
      (navigatorRef.platform === "MacIntel" && navigatorRef.maxTouchPoints > 1);
  }

  function isEmbeddedBrowser(windowRef) {
    const userAgent = String((windowRef.navigator || {}).userAgent || "");
    return /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|; wv[); ]/i.test(userAgent);
  }

  function isStandalone(windowRef) {
    const api = windowRef.TeacherFlaviusPwa;
    if (api && typeof api.isStandalone === "function") {
      return api.isStandalone(windowRef);
    }
    return false;
  }

  function installAvailable(windowRef) {
    const api = windowRef.TeacherFlaviusPwa;
    return Boolean(
      api &&
      typeof api.canPromptInstall === "function" &&
      api.canPromptInstall(windowRef)
    );
  }

  function showManualInstructions(windowRef, refs) {
    refs.instructions.hidden = false;
    if (isEmbeddedBrowser(windowRef)) {
      refs.instructionsText.textContent = isIos(windowRef)
        ? "Abra esta página no Safari pelo menu do aplicativo. Toque em Compartilhar e depois em Adicionar à Tela de Início."
        : "Abra esta página no Google Chrome pelo menu do aplicativo. Depois escolha Instalar aplicativo ou Adicionar à tela inicial.";
      return;
    }

    refs.instructionsText.textContent = isIos(windowRef)
      ? "No iPhone ou iPad, abra esta página no Safari, toque em Compartilhar e depois em Adicionar à Tela de Início."
      : "Abra o menu do navegador e escolha Instalar aplicativo ou Adicionar à tela inicial. Se a opção não aparecer, abra esta página no Google Chrome.";
  }

  function renderState(windowRef, documentRef) {
    const refs = elements(documentRef);

    if (!refs.button || !refs.status || !refs.instructions || !refs.instructionsText) {
      return;
    }

    if (isStandalone(windowRef)) {
      refs.button.disabled = true;
      refs.button.querySelector("span").textContent = "APP JÁ INSTALADO";
      refs.status.textContent = "O aplicativo Teacher Flávio já está instalado neste dispositivo.";
      refs.instructions.hidden = true;
      return;
    }

    if (installAvailable(windowRef)) {
      refs.button.disabled = false;
      refs.button.querySelector("span").textContent = "INSTALAR APP";
      refs.status.textContent = "Toque no botão para iniciar a instalação.";
      refs.instructions.hidden = true;
      return;
    }

    refs.button.disabled = false;
    refs.button.querySelector("span").textContent = "VER COMO INSTALAR";
    refs.status.textContent = "A instalação automática não está disponível neste navegador.";
    showManualInstructions(windowRef, refs);
  }

  async function requestInstall(windowRef, documentRef) {
    const api = windowRef.TeacherFlaviusPwa;
    const refs = elements(documentRef);

    if (!api || typeof api.requestInstall !== "function" || !installAvailable(windowRef)) {
      refs.status.textContent = "Siga as instruções abaixo para instalar o aplicativo.";
      showManualInstructions(windowRef, refs);
      if (typeof refs.instructions.focus === "function") refs.instructions.focus();
      return;
    }

    refs.button.disabled = true;
    refs.status.textContent = "Abrindo a instalação...";

    const result = await api.requestInstall(windowRef);

    if (result && result.outcome === "accepted") {
      refs.status.textContent = "Instalação iniciada.";
      refs.instructions.hidden = true;
      return;
    }

    if (result && result.outcome === "dismissed") {
      refs.status.textContent = "Instalação cancelada. Você pode tentar novamente.";
      renderState(windowRef, documentRef);
      return;
    }

    renderState(windowRef, documentRef);
    refs.status.textContent = "Não foi possível abrir a instalação automaticamente. Use as instruções abaixo.";
    showManualInstructions(windowRef, refs);
  }

  function initialize(windowRef, documentRef) {
    const refs = elements(documentRef);
    const api = windowRef.TeacherFlaviusPwa;

    if (!refs.button) return;

    refs.button.addEventListener("click", function () {
      return requestInstall(windowRef, documentRef);
    });

    if (api && api.installAvailabilityEvent) {
      windowRef.addEventListener(api.installAvailabilityEvent, function () {
        renderState(windowRef, documentRef);
      });
    }

    windowRef.addEventListener("appinstalled", function () {
      renderState(windowRef, documentRef);
    });

    renderState(windowRef, documentRef);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initialize(window, document);
    }, { once: true });
  } else {
    initialize(window, document);
  }
})();

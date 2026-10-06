(function () {
  "use strict";

  const CARD_ID = "pwaInstallCard";
  const BUTTON_ID = "pwaInstallButton";
  let initialized = false;

  function pwaApi(windowRef) {
    const targetWindow = windowRef || window;
    return targetWindow.TeacherFlaviusPwa || null;
  }

  function isNativeApp(api, windowRef) {
    return Boolean(
      api &&
      typeof api.isNativeCapacitorApp === "function" &&
      api.isNativeCapacitorApp(windowRef)
    );
  }

  function shouldShow(windowRef) {
    const targetWindow = windowRef || window;
    const api = pwaApi(targetWindow);
    if (!api) return false;

    if (typeof api.isInstalled === "function") {
      return !api.isInstalled(targetWindow);
    }

    if (typeof api.isStandalone !== "function") return false;
    return !api.isStandalone(targetWindow) && !isNativeApp(api, targetWindow);
  }

  function canPromptInstall(windowRef) {
    const targetWindow = windowRef || window;
    const api = pwaApi(targetWindow);
    return Boolean(
      api &&
      typeof api.canPromptInstall === "function" &&
      api.canPromptInstall(targetWindow)
    );
  }

  function syncVisibility(windowRef, documentRef) {
    const targetDocument = documentRef || document;
    const card = targetDocument.getElementById(CARD_ID);
    if (!card) return;
    card.hidden = !shouldShow(windowRef);
  }

  function manualInstallMessage(windowRef) {
    const targetWindow = windowRef || window;
    const navigatorRef = targetWindow.navigator || {};
    const userAgent = String(navigatorRef.userAgent || "");
    const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent) ||
      (navigatorRef.platform === "MacIntel" && navigatorRef.maxTouchPoints > 1);

    if (isAppleMobile) {
      return "No Safari, abra o menu Compartilhar e escolha Adicionar à Tela de Início.";
    }

    return "Abra o menu do navegador e escolha Instalar app ou Adicionar à tela inicial.";
  }

  function showManualInstallInstructions(windowRef) {
    const targetWindow = windowRef || window;
    if (typeof targetWindow.alert === "function") {
      targetWindow.alert(manualInstallMessage(targetWindow));
    }
  }

  async function requestInstall(windowRef, documentRef) {
    const targetWindow = windowRef || window;
    const targetDocument = documentRef || document;
    const button = targetDocument.getElementById(BUTTON_ID);
    const api = pwaApi(targetWindow);
    if (!button || !api || typeof api.requestInstall !== "function") return;

    if (!canPromptInstall(targetWindow)) {
      showManualInstallInstructions(targetWindow);
      syncVisibility(targetWindow, targetDocument);
      return;
    }

    button.disabled = true;
    try {
      const result = await api.requestInstall(targetWindow);
      if (result && result.outcome === "unavailable") {
        showManualInstallInstructions(targetWindow);
      }
    } finally {
      button.disabled = false;
      syncVisibility(targetWindow, targetDocument);
    }
  }

  function initialize(windowRef, documentRef) {
    if (initialized) return;

    const targetWindow = windowRef || window;
    const targetDocument = documentRef || document;
    const card = targetDocument.getElementById(CARD_ID);
    const button = targetDocument.getElementById(BUTTON_ID);
    const api = pwaApi(targetWindow);
    if (!card || !button || !api) return;

    initialized = true;
    button.addEventListener("click", function () {
      requestInstall(targetWindow, targetDocument);
    });

    if (typeof targetWindow.addEventListener === "function" && api.installAvailabilityEvent) {
      targetWindow.addEventListener(api.installAvailabilityEvent, function () {
        syncVisibility(targetWindow, targetDocument);
      });
    }

    if (typeof targetWindow.addEventListener === "function") {
      targetWindow.addEventListener("appinstalled", function () {
        syncVisibility(targetWindow, targetDocument);
      });
    }

    card.hidden = true;

    if (typeof api.refreshInstalledState === "function") {
      Promise.resolve(api.refreshInstalledState(targetWindow)).finally(function () {
        syncVisibility(targetWindow, targetDocument);
      });
      return;
    }

    syncVisibility(targetWindow, targetDocument);
  }

  window.TeacherFlaviusPwaInstallPrompt = Object.freeze({
    initialize: initialize,
    manualInstallMessage: manualInstallMessage,
    shouldShow: shouldShow,
    syncVisibility: syncVisibility
  });
})();

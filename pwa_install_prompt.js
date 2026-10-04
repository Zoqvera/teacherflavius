(function () {
  "use strict";

  const CARD_ID = "pwaInstallCard";
  const BUTTON_ID = "pwaInstallButton";
  let initialized = false;

  function pwaApi(windowRef) {
    const targetWindow = windowRef || window;
    return targetWindow.TeacherFlaviusPwa || null;
  }

  function shouldShow(windowRef) {
    const api = pwaApi(windowRef);
    if (!api || typeof api.canPromptInstall !== "function" || typeof api.isStandalone !== "function") return false;
    return api.canPromptInstall(windowRef) && !api.isStandalone(windowRef);
  }

  function syncVisibility(windowRef, documentRef) {
    const targetDocument = documentRef || document;
    const card = targetDocument.getElementById(CARD_ID);
    if (!card) return;
    card.hidden = !shouldShow(windowRef);
  }

  async function requestInstall(windowRef, documentRef) {
    const targetWindow = windowRef || window;
    const targetDocument = documentRef || document;
    const button = targetDocument.getElementById(BUTTON_ID);
    const api = pwaApi(targetWindow);
    if (!button || !api || typeof api.requestInstall !== "function") return;

    button.disabled = true;
    try {
      await api.requestInstall(targetWindow);
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

    syncVisibility(targetWindow, targetDocument);
  }

  window.TeacherFlaviusPwaInstallPrompt = Object.freeze({
    initialize: initialize,
    shouldShow: shouldShow,
    syncVisibility: syncVisibility
  });
})();

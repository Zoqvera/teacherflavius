(function () {
  "use strict";

  const SERVICE_WORKER_URL = "/service-worker.js";
  const INSTALL_AVAILABILITY_EVENT = "teacherflavius:pwa-install-availability";
  const REGISTRATION_OPTIONS = Object.freeze({
    scope: "/",
    updateViaCache: "none"
  });

  let deferredInstallPrompt = null;

  function supportsServiceWorkers(navigatorRef) {
    return Boolean(
      navigatorRef &&
      navigatorRef.serviceWorker &&
      typeof navigatorRef.serviceWorker.register === "function"
    );
  }

  function registerServiceWorker(navigatorRef) {
    const targetNavigator = navigatorRef || window.navigator;
    if (!supportsServiceWorkers(targetNavigator)) return Promise.resolve(null);

    return targetNavigator.serviceWorker
      .register(SERVICE_WORKER_URL, REGISTRATION_OPTIONS)
      .catch(function (error) {
        console.warn("Falha ao registrar o service worker do Teacher Flávio.", error);
        return null;
      });
  }

  function isStandalone(windowRef) {
    const targetWindow = windowRef || window;
    const navigatorRef = targetWindow.navigator || {};
    const matchesDisplayMode = typeof targetWindow.matchMedia === "function" &&
      targetWindow.matchMedia("(display-mode: standalone)").matches;

    return matchesDisplayMode || navigatorRef.standalone === true;
  }

  function canPromptInstall(windowRef) {
    return deferredInstallPrompt !== null && !isStandalone(windowRef);
  }

  function dispatchInstallAvailability(windowRef) {
    const targetWindow = windowRef || window;
    if (typeof targetWindow.dispatchEvent !== "function" || typeof targetWindow.Event !== "function") return;
    targetWindow.dispatchEvent(new targetWindow.Event(INSTALL_AVAILABILITY_EVENT));
  }

  function captureInstallPrompt(event, windowRef) {
    if (!event || typeof event.preventDefault !== "function") return;
    event.preventDefault();
    deferredInstallPrompt = event;
    dispatchInstallAvailability(windowRef);
  }

  function clearInstallPrompt(windowRef) {
    deferredInstallPrompt = null;
    dispatchInstallAvailability(windowRef);
  }

  async function requestInstall(windowRef) {
    const targetWindow = windowRef || window;
    if (!canPromptInstall(targetWindow)) return Object.freeze({ outcome: "unavailable" });

    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    dispatchInstallAvailability(targetWindow);

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      return choice || Object.freeze({ outcome: "dismissed" });
    } catch (error) {
      console.warn("Não foi possível abrir a instalação do Teacher Flávio.", error);
      return Object.freeze({ outcome: "error" });
    }
  }

  function installLifecycleListeners(windowRef) {
    const targetWindow = windowRef || window;
    if (typeof targetWindow.addEventListener !== "function") return;

    targetWindow.addEventListener("beforeinstallprompt", function (event) {
      captureInstallPrompt(event, targetWindow);
    });

    targetWindow.addEventListener("appinstalled", function () {
      clearInstallPrompt(targetWindow);
    });
  }

  function initialize(windowRef, documentRef) {
    const targetWindow = windowRef || window;
    const targetDocument = documentRef || document;

    installLifecycleListeners(targetWindow);

    if (targetDocument.readyState === "complete") {
      registerServiceWorker(targetWindow.navigator);
      return;
    }

    targetWindow.addEventListener(
      "load",
      function () {
        registerServiceWorker(targetWindow.navigator);
      },
      { once: true }
    );
  }

  window.TeacherFlaviusPwa = Object.freeze({
    canPromptInstall: canPromptInstall,
    installAvailabilityEvent: INSTALL_AVAILABILITY_EVENT,
    isStandalone: isStandalone,
    registerServiceWorker: registerServiceWorker,
    requestInstall: requestInstall,
    supportsServiceWorkers: supportsServiceWorkers
  });

  initialize(window, document);
})();

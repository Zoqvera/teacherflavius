(function () {
  "use strict";

  const SERVICE_WORKER_URL = "/service-worker.js";
  const INSTALL_AVAILABILITY_EVENT = "teacherflavius:pwa-install-availability";
  const INSTALL_STATE_STORAGE_KEY = "teacherflavius:pwa-installed";
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

  function isNativeCapacitorApp(windowRef) {
    const targetWindow = windowRef || window;
    const capacitor = targetWindow.Capacitor;
    return Boolean(
      capacitor &&
      typeof capacitor.isNativePlatform === "function" &&
      capacitor.isNativePlatform()
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

  function getInstallStateStorage(windowRef) {
    const targetWindow = windowRef || window;
    try {
      return targetWindow.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function hasRecordedInstallation(windowRef) {
    const storage = getInstallStateStorage(windowRef);
    if (!storage || typeof storage.getItem !== "function") return false;

    try {
      return storage.getItem(INSTALL_STATE_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function recordInstallation(windowRef) {
    const targetWindow = windowRef || window;
    const storage = getInstallStateStorage(targetWindow);

    if (storage && typeof storage.setItem === "function") {
      try {
        storage.setItem(INSTALL_STATE_STORAGE_KEY, "1");
      } catch (_) {}
    }

    dispatchInstallAvailability(targetWindow);
  }

  function clearRecordedInstallation(windowRef) {
    const storage = getInstallStateStorage(windowRef);
    if (!storage || typeof storage.removeItem !== "function") return;

    try {
      storage.removeItem(INSTALL_STATE_STORAGE_KEY);
    } catch (_) {}
  }

  function isInstalled(windowRef) {
    const targetWindow = windowRef || window;
    return isNativeCapacitorApp(targetWindow) ||
      isStandalone(targetWindow) ||
      hasRecordedInstallation(targetWindow);
  }

  function canPromptInstall(windowRef) {
    return deferredInstallPrompt !== null && !isInstalled(windowRef);
  }

  async function refreshInstalledState(windowRef) {
    const targetWindow = windowRef || window;
    if (isInstalled(targetWindow)) return true;

    const navigatorRef = targetWindow.navigator || {};
    if (typeof navigatorRef.getInstalledRelatedApps !== "function") {
      return false;
    }

    try {
      const relatedApps = await navigatorRef.getInstalledRelatedApps();
      const pwaIsInstalled = Array.isArray(relatedApps) && relatedApps.some(function (app) {
        return app && app.platform === "webapp";
      });

      if (pwaIsInstalled) {
        recordInstallation(targetWindow);
      }

      return pwaIsInstalled;
    } catch (_) {
      return false;
    }
  }

  function dispatchInstallAvailability(windowRef) {
    const targetWindow = windowRef || window;
    if (typeof targetWindow.dispatchEvent !== "function" || typeof targetWindow.Event !== "function") return;
    targetWindow.dispatchEvent(new targetWindow.Event(INSTALL_AVAILABILITY_EVENT));
  }

  function captureInstallPrompt(event, windowRef) {
    if (!event || typeof event.preventDefault !== "function") return;
    event.preventDefault();

    const targetWindow = windowRef || window;
    clearRecordedInstallation(targetWindow);
    deferredInstallPrompt = event;
    dispatchInstallAvailability(targetWindow);
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
      if (choice && choice.outcome === "accepted") {
        recordInstallation(targetWindow);
      }
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
      deferredInstallPrompt = null;
      recordInstallation(targetWindow);
    });
  }

  function initialize(windowRef, documentRef) {
    const targetWindow = windowRef || window;
    const targetDocument = documentRef || document;

    if (isNativeCapacitorApp(targetWindow)) return;

    if (isStandalone(targetWindow)) {
      recordInstallation(targetWindow);
    }

    installLifecycleListeners(targetWindow);
    void refreshInstalledState(targetWindow);

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
    isInstalled: isInstalled,
    isNativeCapacitorApp: isNativeCapacitorApp,
    isStandalone: isStandalone,
    refreshInstalledState: refreshInstalledState,
    registerServiceWorker: registerServiceWorker,
    requestInstall: requestInstall,
    supportsServiceWorkers: supportsServiceWorkers
  });

  initialize(window, document);
})();

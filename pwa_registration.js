(function () {
  "use strict";

  const SERVICE_WORKER_URL = "/service-worker.js";
  const REGISTRATION_OPTIONS = Object.freeze({
    scope: "/",
    updateViaCache: "none"
  });

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

  function initialize(windowRef, documentRef) {
    const targetWindow = windowRef || window;
    const targetDocument = documentRef || document;

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
    registerServiceWorker: registerServiceWorker,
    supportsServiceWorkers: supportsServiceWorkers
  });

  initialize(window, document);
})();

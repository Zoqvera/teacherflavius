(function () {
  "use strict";

  const EXISTING_SCRIPT_CHECK_DELAY_MS = 0;
  const modulePromises = {};

  function validateConfig(config) {
    const hasRequiredFields = config && config.globalName && config.selector && config.src;
    if (!hasRequiredFields) {
      throw new Error("Configuração de módulo inválida.");
    }
  }

  function getLoadedModule(globalName) {
    return window[globalName] || null;
  }

  function getMissingModuleMessage(config) {
    return config.missingMessage || ("O módulo " + config.globalName + " não foi inicializado.");
  }

  function getLoadErrorMessage(config) {
    return config.loadErrorMessage || ("Não foi possível carregar o módulo " + config.globalName + ".");
  }

  function scriptRequestCompleted(script) {
    const readyState = String(script && script.readyState || "").toLowerCase();
    if (readyState === "loaded" || readyState === "complete") return true;

    const performanceApi = window.performance;
    if (!script || !script.src || !performanceApi || typeof performanceApi.getEntriesByName !== "function") {
      return false;
    }

    return performanceApi.getEntriesByName(script.src).some(function (entry) {
      return !entry.initiatorType || entry.initiatorType === "script";
    });
  }

  function createModulePromise(config) {
    return new Promise(function (resolve, reject) {
      let script = null;
      let settled = false;
      let inspectionTimer = null;

      function cleanup() {
        if (inspectionTimer !== null) {
          window.clearTimeout(inspectionTimer);
          inspectionTimer = null;
        }
        if (!script) return;
        script.removeEventListener("load", resolveModule);
        script.removeEventListener("error", rejectModule);
      }

      function rejectWith(message) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message));
      }

      function resolveModule() {
        if (settled) return;
        const loadedModule = getLoadedModule(config.globalName);
        if (!loadedModule) {
          rejectWith(getMissingModuleMessage(config));
          return;
        }
        settled = true;
        cleanup();
        resolve(loadedModule);
      }

      function rejectModule() {
        rejectWith(getLoadErrorMessage(config));
      }

      function observeScript() {
        script.addEventListener("load", resolveModule, { once: true });
        script.addEventListener("error", rejectModule, { once: true });
      }

      function inspectExistingScript() {
        inspectionTimer = window.setTimeout(function () {
          inspectionTimer = null;
          if (settled) return;
          if (getLoadedModule(config.globalName)) {
            resolveModule();
            return;
          }
          if (scriptRequestCompleted(script)) {
            rejectWith(getMissingModuleMessage(config));
          }
        }, EXISTING_SCRIPT_CHECK_DELAY_MS);
      }

      script = document.querySelector(config.selector);
      if (script) {
        observeScript();
        inspectExistingScript();
        return;
      }

      script = document.createElement("script");
      script.src = config.src;
      script.async = true;
      observeScript();
      document.head.appendChild(script);
    });
  }

  function loadGlobalModule(config) {
    validateConfig(config);

    const existingModule = getLoadedModule(config.globalName);
    if (existingModule) return Promise.resolve(existingModule);
    if (modulePromises[config.globalName]) return modulePromises[config.globalName];

    modulePromises[config.globalName] = createModulePromise(config);
    return modulePromises[config.globalName];
  }

  window.ModuleLoader = Object.freeze({
    loadGlobalModule: loadGlobalModule
  });
})();

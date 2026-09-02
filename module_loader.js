(function () {
  "use strict";

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

  function createModulePromise(config) {
    return new Promise(function (resolve, reject) {
      function resolveModule() {
        const loadedModule = getLoadedModule(config.globalName);
        if (!loadedModule) {
          reject(new Error(getMissingModuleMessage(config)));
          return;
        }
        resolve(loadedModule);
      }

      function rejectModule() {
        reject(new Error(getLoadErrorMessage(config)));
      }

      const existingScript = document.querySelector(config.selector);
      if (existingScript) {
        existingScript.addEventListener("load", resolveModule, { once: true });
        existingScript.addEventListener("error", rejectModule, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = config.src;
      script.async = true;
      script.addEventListener("load", resolveModule, { once: true });
      script.addEventListener("error", rejectModule, { once: true });
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
(function () {
  "use strict";

  const MAX_LOCAL_RETRIES = 1;
  const RETRY_DELAY_MS = 600;
  const pendingScripts = new Map();

  function isLocalAsset(url) {
    return typeof url === "string" && url.startsWith("/") && !url.startsWith("//");
  }

  function loadScript(id, src, callback) {
    const pending = pendingScripts.get(id);
    if (pending) {
      if (callback) pending.callbacks.push(callback);
      return;
    }

    if (document.getElementById(id)) {
      if (callback) callback();
      return;
    }

    const callbacks = callback ? [callback] : [];
    let retries = 0;
    pendingScripts.set(id, { callbacks: callbacks });

    function finish() {
      pendingScripts.delete(id);
      callbacks.forEach(function (notify) { notify(); });
    }

    function attempt() {
      const script = document.createElement("script");
      script.id = id;
      script.src = src;
      script.async = false;
      script.onload = finish;
      script.onerror = function () {
        script.remove();
        if (isLocalAsset(src) && retries < MAX_LOCAL_RETRIES) {
          retries += 1;
          window.setTimeout(attempt, RETRY_DELAY_MS);
          return;
        }
        finish();
      };
      document.head.appendChild(script);
    }

    attempt();
  }

  function loadScriptAsset(asset, callback) {
    loadScript(asset.id, asset.src, callback);
  }

  function loadStylesheet(id, href) {
    if (document.getElementById(id)) return;

    let retries = 0;
    function attempt() {
      const stylesheet = document.createElement("link");
      stylesheet.id = id;
      stylesheet.rel = "stylesheet";
      stylesheet.href = href;
      stylesheet.onerror = function () {
        stylesheet.remove();
        if (isLocalAsset(href) && retries < MAX_LOCAL_RETRIES) {
          retries += 1;
          window.setTimeout(attempt, RETRY_DELAY_MS);
        }
      };
      document.head.appendChild(stylesheet);
    }

    attempt();
  }

  function loadStylesheetAsset(asset) {
    loadStylesheet(asset.id, asset.href);
  }

  window.SiteAssetLoader = Object.freeze({
    loadScript: loadScript,
    loadScriptAsset: loadScriptAsset,
    loadStylesheet: loadStylesheet,
    loadStylesheetAsset: loadStylesheetAsset
  });
})();

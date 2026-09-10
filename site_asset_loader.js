(function () {
  "use strict";

  function loadScript(id, src, callback) {
    const existing = document.getElementById(id);
    if (existing) {
      if (callback) callback();
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = false;
    if (callback) {
      script.onload = callback;
      script.onerror = callback;
    }
    document.head.appendChild(script);
  }

  function loadScriptAsset(asset, callback) {
    loadScript(asset.id, asset.src, callback);
  }

  function loadStylesheet(id, href) {
    if (document.getElementById(id)) return;

    const stylesheet = document.createElement("link");
    stylesheet.id = id;
    stylesheet.rel = "stylesheet";
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
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

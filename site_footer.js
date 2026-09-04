(function () {
  "use strict";

  const SITE_ASSET_LOADER_SRC = "/site_asset_loader.js?v=20260902-1";
  const SITE_RUNTIME_CONFIG_ASSET = Object.freeze({
    id: "teacher-flavius-site-runtime-config",
    src: "/site_runtime_config.js?v=20260904-2"
  });
  const MARKETING_TRACKING_CONTROL_ASSET = Object.freeze({
    id: "teacher-flavius-marketing-tracking-control",
    src: "/marketing_tracking_control.js?v=20260904-1"
  });
  let runtimeConfig = null;

  function loadScriptAsset(asset, callback) {
    window.SiteAssetLoader.loadScriptAsset(asset, callback);
  }

  function loadStylesheetAsset(asset) {
    window.SiteAssetLoader.loadStylesheetAsset(asset);
  }

  function scriptAssets() {
    return runtimeConfig.scriptAssets;
  }

  function loadWhatsappLeadForm() {
    loadScriptAsset(scriptAssets().whatsappLeadForm);
  }

  function isMarketingAcquisitionPage() {
    return (window.location.pathname || "").toLowerCase().indexOf("/marketing_acquisition") === 0;
  }

  function loadMarketingTrackingControl() {
    if (!isMarketingAcquisitionPage()) return;
    loadScriptAsset(scriptAssets().marketingTrackingControl || MARKETING_TRACKING_CONTROL_ASSET);
  }

  function configurePrivacyAnalytics() {
    if (!window.SitePrivacyAnalytics) return;
    window.SitePrivacyAnalytics.initialize({
      measurementId: runtimeConfig.googleMeasurementId,
      loadScriptAsset: loadScriptAsset,
      assets: runtimeConfig.privacyAnalyticsAssets
    });
  }

  function initializePrivacyAnalytics() {
    if (window.SitePrivacyAnalytics) {
      configurePrivacyAnalytics();
      return;
    }
    loadScriptAsset(scriptAssets().sitePrivacyAnalytics, configurePrivacyAnalytics);
  }

  function configurePageRuntime() {
    if (!window.SitePageRuntime) return;
    const pageRuntime = window.SitePageRuntime.create({
      runtimeConfig: runtimeConfig,
      loadScriptAsset: loadScriptAsset,
      loadStylesheetAsset: loadStylesheetAsset
    });
    pageRuntime.initialize();
  }

  function initializePageRuntime() {
    if (window.SitePageRuntime) {
      configurePageRuntime();
      return;
    }
    loadScriptAsset(scriptAssets().sitePageRuntime, configurePageRuntime);
  }

  function initializeFooterRuntime() {
    if (!window.SiteAssetLoader || !window.SiteRuntimeConfig) return;
    runtimeConfig = window.SiteRuntimeConfig;

    // Keep compatibility bootstraps available for browsers that cached older pages.
    loadWhatsappLeadForm();
    loadMarketingTrackingControl();
    initializePrivacyAnalytics();
    initializePageRuntime();
  }

  function initializeRuntimeConfig() {
    if (window.SiteRuntimeConfig) {
      initializeFooterRuntime();
      return;
    }
    loadScriptAsset(SITE_RUNTIME_CONFIG_ASSET, initializeFooterRuntime);
  }

  function bootstrapAssetLoader() {
    if (window.SiteAssetLoader) {
      initializeRuntimeConfig();
      return;
    }

    const script = document.createElement("script");
    script.src = SITE_ASSET_LOADER_SRC;
    script.async = false;
    script.addEventListener("load", initializeRuntimeConfig, { once: true });
    script.addEventListener("error", function () {
      console.warn("Não foi possível carregar a infraestrutura de assets do site.");
    }, { once: true });
    document.head.appendChild(script);
  }

  bootstrapAssetLoader();
})();

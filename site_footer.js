(function () {
  "use strict";

  const SITE_ASSET_LOADER_SRC = "/site_asset_loader.js?v=20260902-1";
  const SITE_RUNTIME_CONFIG_ASSET = Object.freeze({
    id: "teacher-flavius-site-runtime-config",
    src: "/site_runtime_config.js?v=20260902-1"
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

  function initializeWhatsappUi() {
    const watchDynamicLinks = !window.SitePageContext.isPublicMarketingPage();
    loadScriptAsset(scriptAssets().siteWhatsapp, function () {
      if (!window.SiteWhatsapp) return;
      window.SiteWhatsapp.initialize({ watchDynamicLinks: watchDynamicLinks });
    });
  }

  function refreshWhatsappLinks() {
    if (window.SiteWhatsapp) window.SiteWhatsapp.standardizeLinks(document);
  }

  function initializeEnrollmentGuard() {
    if (!window.SiteEnrollmentGuard) return;
    window.SiteEnrollmentGuard.initialize({
      watchDynamicLinks: !window.SitePageContext.isPublicMarketingPage()
    });
  }

  function refreshEnrollmentLinks() {
    if (window.SiteEnrollmentGuard) window.SiteEnrollmentGuard.removeLinks(document);
  }

  function loadAccessibility() {
    loadStylesheetAsset(runtimeConfig.stylesheetAssets.accessibility);
    loadScriptAsset(scriptAssets().accessibility);
  }

  function loadMobileTopNavigation() {
    loadScriptAsset(scriptAssets().mobileTopNavigation);
  }

  function loadFooterCore() {
    loadScriptAsset(scriptAssets().footerCore, function () {
      refreshEnrollmentLinks();
      refreshWhatsappLinks();
    });
  }

  function loadPublicPageScripts() {
    if (window.SitePageContext.currentPath() === "/") {
      loadFooterCore();
      return;
    }
    if (window.SitePageContext.isGeoContentPage()) {
      loadScriptAsset(scriptAssets().cleanUrls);
      return;
    }
    loadScriptAsset(scriptAssets().cleanUrls, loadFooterCore);
  }

  function loadPortalScripts() {
    loadScriptAsset(scriptAssets().cleanUrls, function () {
      loadScriptAsset(scriptAssets().googleOnlyAccess, function () {
        loadScriptAsset(scriptAssets().studentBirthdays, loadFooterCore);
      });
    });
  }

  function initializeUi() {
    window.SiteBranding.install();
    loadAccessibility();
    if (!window.SitePageContext.isHomePage()) loadMobileTopNavigation();
    initializeEnrollmentGuard();
    initializeWhatsappUi();
  }

  function schedulePublicScripts() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadPublicPageScripts, {
        timeout: runtimeConfig.publicScriptsIdleTimeoutMs
      });
      return;
    }
    window.setTimeout(loadPublicPageScripts, 0);
  }

  function initializePageRuntime() {
    if (!window.SitePageContext || !window.SiteBranding || !window.SiteEnrollmentGuard) return;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeUi, { once: true });
    } else {
      initializeUi();
    }

    if (window.SitePageContext.isPublicMarketingPage()) schedulePublicScripts();
    else loadPortalScripts();
  }

  function loadSiteFoundations() {
    loadScriptAsset(scriptAssets().sitePageContext, function () {
      if (!window.SitePageContext) return;
      loadScriptAsset(scriptAssets().siteBranding, function () {
        if (!window.SiteBranding) return;
        loadScriptAsset(scriptAssets().siteEnrollmentGuard, initializePageRuntime);
      });
    });
  }

  function initializeFooterRuntime() {
    if (!window.SiteAssetLoader || !window.SiteRuntimeConfig) return;
    runtimeConfig = window.SiteRuntimeConfig;

    // Keep compatibility bootstraps available for browsers that cached older pages.
    loadWhatsappLeadForm();
    initializePrivacyAnalytics();
    loadSiteFoundations();
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

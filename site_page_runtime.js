(function () {
  "use strict";

  function assertFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError("SitePageRuntime requer " + name + ".");
    }
  }

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== "object") {
      throw new TypeError("SitePageRuntime requer dependências de inicialização.");
    }
    if (!dependencies.runtimeConfig || !dependencies.runtimeConfig.scriptAssets) {
      throw new Error("SitePageRuntime requer runtimeConfig válido.");
    }
    assertFunction(dependencies.loadScriptAsset, "loadScriptAsset");
    assertFunction(dependencies.loadStylesheetAsset, "loadStylesheetAsset");
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    const runtimeConfig = deps.runtimeConfig;
    const scriptAssets = runtimeConfig.scriptAssets;
    const stylesheetAssets = runtimeConfig.stylesheetAssets;
    const windowRef = deps.windowRef || window;
    const documentRef = deps.documentRef || document;

    function pageContext() {
      return windowRef.SitePageContext;
    }

    function loadAccessibility() {
      deps.loadStylesheetAsset(stylesheetAssets.accessibility);
      deps.loadScriptAsset(scriptAssets.accessibility);
    }

    function loadMobileTopNavigation() {
      deps.loadScriptAsset(scriptAssets.mobileTopNavigation);
    }

    function initializeEnrollmentGuard() {
      const enrollmentGuard = windowRef.SiteEnrollmentGuard;
      if (!enrollmentGuard) return;
      enrollmentGuard.initialize({
        watchDynamicLinks: !pageContext().isPublicMarketingPage()
      });
    }

    function initializeWhatsappUi() {
      const watchDynamicLinks = !pageContext().isPublicMarketingPage();
      deps.loadScriptAsset(scriptAssets.siteWhatsapp, function () {
        if (!windowRef.SiteWhatsapp) return;
        windowRef.SiteWhatsapp.initialize({ watchDynamicLinks: watchDynamicLinks });
      });
    }

    function refreshFooterLinks() {
      if (windowRef.SiteEnrollmentGuard) {
        windowRef.SiteEnrollmentGuard.removeLinks(documentRef);
      }
      if (windowRef.SiteWhatsapp) {
        windowRef.SiteWhatsapp.standardizeLinks(documentRef);
      }
    }

    function loadFooterCore() {
      deps.loadScriptAsset(scriptAssets.footerCore, refreshFooterLinks);
    }

    function loadPublicPageScripts() {
      if (pageContext().currentPath() === "/") {
        loadFooterCore();
        return;
      }
      if (pageContext().isGeoContentPage()) {
        deps.loadScriptAsset(scriptAssets.cleanUrls);
        return;
      }
      deps.loadScriptAsset(scriptAssets.cleanUrls, loadFooterCore);
    }

    function loadPortalScripts() {
      deps.loadScriptAsset(scriptAssets.cleanUrls, function () {
        deps.loadScriptAsset(scriptAssets.googleOnlyAccess, function () {
          deps.loadScriptAsset(scriptAssets.studentBirthdays, loadFooterCore);
        });
      });
    }

    function initializeUi() {
      if (windowRef.SiteBranding) windowRef.SiteBranding.install();
      loadAccessibility();
      if (!pageContext().isHomePage()) loadMobileTopNavigation();
      initializeEnrollmentGuard();
      initializeWhatsappUi();
    }

    function schedulePublicScripts() {
      if ("requestIdleCallback" in windowRef) {
        windowRef.requestIdleCallback(loadPublicPageScripts, {
          timeout: runtimeConfig.publicScriptsIdleTimeoutMs
        });
        return;
      }
      windowRef.setTimeout(loadPublicPageScripts, 0);
    }

    function initializeResolvedRuntime() {
      if (!pageContext() || !windowRef.SiteBranding || !windowRef.SiteEnrollmentGuard) return;

      if (documentRef.readyState === "loading") {
        documentRef.addEventListener("DOMContentLoaded", initializeUi, { once: true });
      } else {
        initializeUi();
      }

      if (pageContext().isPublicMarketingPage()) schedulePublicScripts();
      else loadPortalScripts();
    }

    function loadSiteFoundations() {
      deps.loadScriptAsset(scriptAssets.sitePageContext, function () {
        if (!windowRef.SitePageContext) return;
        deps.loadScriptAsset(scriptAssets.siteBranding, function () {
          if (!windowRef.SiteBranding) return;
          deps.loadScriptAsset(scriptAssets.siteEnrollmentGuard, initializeResolvedRuntime);
        });
      });
    }

    return Object.freeze({
      initialize: loadSiteFoundations
    });
  }

  window.SitePageRuntime = Object.freeze({
    create: create
  });
})();

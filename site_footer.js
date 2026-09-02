(function () {
  "use strict";

  const GOOGLE_MEASUREMENT_ID = "G-11V3W5B6TG";
  const PUBLIC_SCRIPTS_IDLE_TIMEOUT_MS = 1200;
  const SCRIPT_ASSETS = Object.freeze({
    whatsappLeadForm: Object.freeze({
      id: "teacher-flavius-whatsapp-lead-form",
      src: "/whatsapp_lead_form.js?v=20260902-direct-2"
    }),
    siteWhatsapp: Object.freeze({
      id: "teacher-flavius-site-whatsapp",
      src: "/site_whatsapp.js?v=20260902-1"
    }),
    accessibility: Object.freeze({
      id: "teacher-flavius-accessibility",
      src: "/accessibility.js?v=20260820-1"
    }),
    cro: Object.freeze({
      id: "teacher-flavius-cro",
      src: "/cro.js?v=20260820-1"
    }),
    analytics: Object.freeze({
      id: "teacher-flavius-analytics",
      src: "/analytics.js?v=20260820-1"
    }),
    analyticsAttribution: Object.freeze({
      id: "teacher-flavius-analytics-attribution",
      src: "/analytics_attribution.js?v=20260902-leadfix-1"
    }),
    privacyConsent: Object.freeze({
      id: "teacher-flavius-privacy-consent",
      src: "/privacy_consent.js?v=20260820-2"
    }),
    sitePrivacyAnalytics: Object.freeze({
      id: "teacher-flavius-site-privacy-analytics",
      src: "/site_privacy_analytics.js?v=20260902-1"
    }),
    mobileTopNavigation: Object.freeze({
      id: "teacher-flavius-mobile-top-navigation",
      src: "/mobile_top_navigation.js?v=20260820-desktop-menu-1"
    }),
    footerCore: Object.freeze({
      id: "teacher-flavius-site-footer-core",
      src: "/site_footer_core.js?v=20260820-privacy-1"
    }),
    cleanUrls: Object.freeze({
      id: "teacher-flavius-clean-urls",
      src: "/clean_urls.js?v=20260819-1"
    }),
    googleOnlyAccess: Object.freeze({
      id: "teacher-flavius-google-only-access",
      src: "/google_only_access.js?v=20260819-1"
    }),
    studentBirthdays: Object.freeze({
      id: "teacher-flavius-student-birthdays",
      src: "/student_birthdays.js?v=20260819-1"
    }),
    sitePageContext: Object.freeze({
      id: "teacher-flavius-site-page-context",
      src: "/site_page_context.js?v=20260902-1"
    }),
    siteBranding: Object.freeze({
      id: "teacher-flavius-site-branding",
      src: "/site_branding.js?v=20260902-1"
    }),
    siteEnrollmentGuard: Object.freeze({
      id: "teacher-flavius-site-enrollment-guard",
      src: "/site_enrollment_guard.js?v=20260902-1"
    })
  });
  const PRIVACY_ANALYTICS_ASSETS = Object.freeze({
    privacyConsent: SCRIPT_ASSETS.privacyConsent,
    analyticsAttribution: SCRIPT_ASSETS.analyticsAttribution,
    analytics: SCRIPT_ASSETS.analytics,
    cro: SCRIPT_ASSETS.cro
  });
  const STYLESHEET_ASSETS = Object.freeze({
    accessibility: Object.freeze({
      id: "teacher-flavius-accessibility-styles",
      href: "/accessibility.css?v=20260820-1"
    })
  });

  function loadScript(id, src, callback) {
    var existing = document.getElementById(id);
    if (existing) {
      if (callback) callback();
      return;
    }
    var script = document.createElement("script");
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
    var stylesheet = document.createElement("link");
    stylesheet.id = id;
    stylesheet.rel = "stylesheet";
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
  }

  function loadStylesheetAsset(asset) {
    loadStylesheet(asset.id, asset.href);
  }

  function loadWhatsappLeadForm() {
    loadScriptAsset(SCRIPT_ASSETS.whatsappLeadForm);
  }

  function configurePrivacyAnalytics() {
    if (!window.SitePrivacyAnalytics) return;
    window.SitePrivacyAnalytics.initialize({
      measurementId: GOOGLE_MEASUREMENT_ID,
      loadScriptAsset: loadScriptAsset,
      assets: PRIVACY_ANALYTICS_ASSETS
    });
  }

  function initializePrivacyAnalytics() {
    if (window.SitePrivacyAnalytics) {
      configurePrivacyAnalytics();
      return;
    }
    loadScriptAsset(SCRIPT_ASSETS.sitePrivacyAnalytics, configurePrivacyAnalytics);
  }

  function initializeWhatsappUi() {
    var watchDynamicLinks = !window.SitePageContext.isPublicMarketingPage();
    loadScriptAsset(SCRIPT_ASSETS.siteWhatsapp, function () {
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
    loadStylesheetAsset(STYLESHEET_ASSETS.accessibility);
    loadScriptAsset(SCRIPT_ASSETS.accessibility);
  }

  function loadMobileTopNavigation() {
    loadScriptAsset(SCRIPT_ASSETS.mobileTopNavigation);
  }

  function loadFooterCore() {
    loadScriptAsset(SCRIPT_ASSETS.footerCore, function () {
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
      loadScriptAsset(SCRIPT_ASSETS.cleanUrls);
      return;
    }
    loadScriptAsset(SCRIPT_ASSETS.cleanUrls, loadFooterCore);
  }

  function loadPortalScripts() {
    loadScriptAsset(SCRIPT_ASSETS.cleanUrls, function () {
      loadScriptAsset(SCRIPT_ASSETS.googleOnlyAccess, function () {
        loadScriptAsset(SCRIPT_ASSETS.studentBirthdays, loadFooterCore);
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
      window.requestIdleCallback(loadPublicPageScripts, { timeout: PUBLIC_SCRIPTS_IDLE_TIMEOUT_MS });
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
    loadScriptAsset(SCRIPT_ASSETS.sitePageContext, function () {
      if (!window.SitePageContext) return;
      loadScriptAsset(SCRIPT_ASSETS.siteBranding, function () {
        if (!window.SiteBranding) return;
        loadScriptAsset(SCRIPT_ASSETS.siteEnrollmentGuard, initializePageRuntime);
      });
    });
  }

  // Keep the compatibility bootstrap available for browsers that cached older pages.
  loadWhatsappLeadForm();
  initializePrivacyAnalytics();
  loadSiteFoundations();
})();

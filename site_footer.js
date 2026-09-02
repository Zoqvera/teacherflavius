(function () {
  "use strict";

  var GOOGLE_MEASUREMENT_ID = "G-11V3W5B6TG";

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

  function loadStylesheet(id, href) {
    if (document.getElementById(id)) return;
    var stylesheet = document.createElement("link");
    stylesheet.id = id;
    stylesheet.rel = "stylesheet";
    stylesheet.href = href;
    document.head.appendChild(stylesheet);
  }

  function loadWhatsappLeadForm() {
    loadScript("teacher-flavius-whatsapp-lead-form", "/whatsapp_lead_form.js?v=20260902-direct-2");
  }

  function initializeWhatsappUi() {
    var watchDynamicLinks = !window.SitePageContext.isPublicMarketingPage();
    loadScript("teacher-flavius-site-whatsapp", "/site_whatsapp.js?v=20260902-1", function () {
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
    loadStylesheet("teacher-flavius-accessibility-styles", "/accessibility.css?v=20260820-1");
    loadScript("teacher-flavius-accessibility", "/accessibility.js?v=20260820-1");
  }

  function loadCro() {
    loadScript("teacher-flavius-cro", "/cro.js?v=20260820-1");
  }

  function loadAnalyticsCore() {
    loadScript("teacher-flavius-analytics", "/analytics.js?v=20260820-1", loadCro);
  }

  function loadAnalytics() {
    loadScript("teacher-flavius-analytics-attribution", "/analytics_attribution.js?v=20260902-leadfix-1", loadAnalyticsCore);
  }

  function disableAnalytics() {
    window["ga-disable-" + GOOGLE_MEASUREMENT_ID] = true;
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
    }
  }

  function applyPrivacyChoice() {
    var privacy = window.TeacherFlaviusPrivacy;
    if (privacy && typeof privacy.hasAnalyticsConsent === "function" && privacy.hasAnalyticsConsent()) {
      window["ga-disable-" + GOOGLE_MEASUREMENT_ID] = false;
      loadAnalytics();
    } else {
      disableAnalytics();
    }
  }

  function loadPrivacy() {
    window.addEventListener("tf:privacy-consent-changed", applyPrivacyChoice);
    loadScript("teacher-flavius-privacy-consent", "/privacy_consent.js?v=20260820-2", applyPrivacyChoice);
  }

  function loadMobileTopNavigation() {
    loadScript("teacher-flavius-mobile-top-navigation", "/mobile_top_navigation.js?v=20260820-desktop-menu-1");
  }

  function loadFooterCore() {
    loadScript("teacher-flavius-site-footer-core", "/site_footer_core.js?v=20260820-privacy-1", function () {
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
      loadScript("teacher-flavius-clean-urls", "/clean_urls.js?v=20260819-1");
      return;
    }
    loadScript("teacher-flavius-clean-urls", "/clean_urls.js?v=20260819-1", loadFooterCore);
  }

  function loadPortalScripts() {
    loadScript("teacher-flavius-clean-urls", "/clean_urls.js?v=20260819-1", function () {
      loadScript("teacher-flavius-google-only-access", "/google_only_access.js?v=20260819-1", function () {
        loadScript("teacher-flavius-student-birthdays", "/student_birthdays.js?v=20260819-1", loadFooterCore);
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
    if ("requestIdleCallback" in window) window.requestIdleCallback(loadPublicPageScripts, { timeout: 1200 });
    else window.setTimeout(loadPublicPageScripts, 0);
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
    loadScript("teacher-flavius-site-page-context", "/site_page_context.js?v=20260902-1", function () {
      if (!window.SitePageContext) return;
      loadScript("teacher-flavius-site-branding", "/site_branding.js?v=20260902-1", function () {
        if (!window.SiteBranding) return;
        loadScript(
          "teacher-flavius-site-enrollment-guard",
          "/site_enrollment_guard.js?v=20260902-1",
          initializePageRuntime
        );
      });
    });
  }

  // Keep the compatibility bootstrap available for browsers that cached older pages.
  loadWhatsappLeadForm();
  loadPrivacy();
  loadSiteFoundations();
})();

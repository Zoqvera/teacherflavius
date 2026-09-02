(function () {
  "use strict";

  var GOOGLE_MEASUREMENT_ID = "G-11V3W5B6TG";

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function isHomePage() {
    var path = currentPath();
    return path === "/" || path === "/index.html";
  }

  function isGeoContentPage() {
    var path = currentPath();
    return path.indexOf("/sobre") === 0 || path.indexOf("/recursos") === 0;
  }

  function isPublicMarketingPage() {
    var path = currentPath();
    return path === "/" ||
      path === "/index.html" ||
      path === "/privacidade" ||
      path === "/privacidade/" ||
      path === "/cookies" ||
      path === "/cookies/" ||
      path === "/termos" ||
      path === "/termos/" ||
      path === "/quero_conhecer" ||
      path === "/quero_conhecer.html" ||
      path === "/quero-conhecer" ||
      path === "/quero-conhecer/" ||
      path.indexOf("/curso-de-ingles-online") === 0 ||
      path.indexOf("/sobre") === 0 ||
      path.indexOf("/recursos") === 0 ||
      path.indexOf("/landing-page") === 0;
  }

  function installBrandPalette() {
    var root = document.documentElement;
    var path = currentPath();

    root.classList.add("tf-brand-palette");
    if (path === "/" || path === "/index.html") root.classList.add("tf-brand-home");
    if (
      path === "/quero_conhecer" ||
      path === "/quero_conhecer.html" ||
      path === "/quero-conhecer" ||
      path === "/quero-conhecer/" ||
      path.indexOf("/curso-de-ingles-online") === 0 ||
      path.indexOf("/landing-page") === 0
    ) root.classList.add("tf-brand-sales");

    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", "#02102B");

    var palette = document.getElementById("teacher-flavius-brand-palette");
    if (!palette) {
      palette = document.createElement("link");
      palette.id = "teacher-flavius-brand-palette";
      palette.rel = "stylesheet";
      document.head.appendChild(palette);
    }
    palette.href = "/brand_palette.css?v=20260820-3";

    if (document.body) {
      var bodyColor = window.getComputedStyle(document.body).color || "";
      var rgb = bodyColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (rgb) {
        var luminance = (Number(rgb[1]) * 0.2126) + (Number(rgb[2]) * 0.7152) + (Number(rgb[3]) * 0.0722);
        if (luminance >= 150) root.classList.add("tf-brand-dark-page");
      }
    }
  }

  function isEnrollmentLink(value) {
    if (!value) return false;
    try {
      var url = new URL(value, window.location.href);
      return url.origin === window.location.origin &&
        (url.pathname === "/matricula/" || url.pathname === "/matricula.html");
    } catch (error) {
      return false;
    }
  }

  function removeEnrollmentLinks(root) {
    var target = root && root.querySelectorAll ? root : document;
    target.querySelectorAll("a[href]").forEach(function (link) {
      if (isEnrollmentLink(link.getAttribute("href"))) link.remove();
    });
  }

  function installEnrollmentLinkGuard() {
    removeEnrollmentLinks(document);
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && node.matches("a[href]") && isEnrollmentLink(node.getAttribute("href"))) {
            node.remove();
            return;
          }
          removeEnrollmentLinks(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

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
    loadScript("teacher-flavius-whatsapp-lead-form", "/whatsapp_lead_form.js?v=20260901-1");
  }

  function initializeWhatsappUi() {
    var watchDynamicLinks = !isPublicMarketingPage();
    loadScript("teacher-flavius-site-whatsapp", "/site_whatsapp.js?v=20260902-1", function () {
      if (!window.SiteWhatsapp) return;
      window.SiteWhatsapp.initialize({ watchDynamicLinks: watchDynamicLinks });
    });
  }

  function refreshWhatsappLinks() {
    if (window.SiteWhatsapp) window.SiteWhatsapp.standardizeLinks(document);
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
    loadScript("teacher-flavius-analytics-attribution", "/analytics_attribution.js?v=20260901-2", loadAnalyticsCore);
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
      removeEnrollmentLinks(document);
      refreshWhatsappLinks();
    });
  }

  function loadPublicPageScripts() {
    if (currentPath() === "/") {
      loadFooterCore();
      return;
    }
    if (isGeoContentPage()) {
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
    installBrandPalette();
    loadAccessibility();
    if (!isHomePage()) loadMobileTopNavigation();
    if (isPublicMarketingPage()) removeEnrollmentLinks(document);
    else installEnrollmentLinkGuard();
    initializeWhatsappUi();
  }

  function schedulePublicScripts() {
    if ("requestIdleCallback" in window) window.requestIdleCallback(loadPublicPageScripts, { timeout: 1200 });
    else window.setTimeout(loadPublicPageScripts, 0);
  }

  // This must be registered before privacy/analytics so non-floating WhatsApp
  // clicks are intercepted before they can be counted as leads.
  loadWhatsappLeadForm();
  loadPrivacy();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeUi, { once: true });
  } else {
    initializeUi();
  }

  if (isPublicMarketingPage()) schedulePublicScripts();
  else loadPortalScripts();
})();

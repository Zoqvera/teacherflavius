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

  function installWhatsappFloat() {
    if (!document.body || document.getElementById("teacher-flavius-whatsapp-float")) return;

    var whatsappNumber = "5534998349756";
    var whatsappMessage = "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês.";
    var whatsappUrl = "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent(whatsappMessage);

    var floatingWhatsapp = document.createElement("a");
    floatingWhatsapp.id = "teacher-flavius-whatsapp-float";
    floatingWhatsapp.className = "whatsapp-float";
    floatingWhatsapp.href = whatsappUrl;
    floatingWhatsapp.target = "_blank";
    floatingWhatsapp.rel = "noopener noreferrer";
    floatingWhatsapp.setAttribute("aria-label", "Falar com o Teacher Flávio pelo WhatsApp");
    floatingWhatsapp.innerHTML = [
      '<svg class="whatsapp-float-icon" viewBox="0 0 32 32" aria-hidden="true">',
      '<path fill="currentColor" d="M16.04 3C9.42 3 4.05 8.25 4.05 14.73c0 2.28.67 4.51 1.94 6.41L4 28.2l7.32-1.91a12.13 12.13 0 0 0 4.71.94h.01c6.61 0 12-5.26 12-11.73C28.04 9 22.65 3 16.04 3Zm0 21.91h-.01a9.86 9.86 0 0 1-4.99-1.35l-.36-.21-4.34 1.13 1.16-4.13-.24-.38a9.38 9.38 0 0 1-1.5-5.24c0-5.21 4.6-9.45 10.27-9.45 5.66 0 10.27 4.24 10.27 9.45 0 5.22-4.61 10.18-10.26 10.18Zm5.63-7.08c-.31-.15-1.82-.88-2.1-.98-.28-.1-.49-.15-.69.15-.2.3-.8.98-.98 1.18-.18.2-.36.22-.67.07-.31-.15-1.3-.47-2.48-1.49-.92-.8-1.53-1.79-1.71-2.09-.18-.3-.02-.46.13-.61.14-.13.31-.35.46-.53.15-.18.2-.3.31-.5.1-.2.05-.38-.03-.53-.08-.15-.69-1.63-.95-2.23-.25-.6-.5-.52-.69-.53h-.59c-.2 0-.54.08-.82.38-.28.3-1.08 1.03-1.08 2.51 0 1.48 1.1 2.91 1.25 3.11.15.2 2.16 3.24 5.23 4.54.73.31 1.3.49 1.75.63.73.23 1.4.2 1.93.12.59-.09 1.82-.73 2.08-1.43.26-.7.26-1.3.18-1.43-.08-.13-.28-.2-.59-.35Z"/>',
      '</svg>',
      '<span>Fale no WhatsApp</span>'
    ].join("");

    if (!document.getElementById("teacher-flavius-whatsapp-float-styles")) {
      var floatingWhatsappStyles = document.createElement("style");
      floatingWhatsappStyles.id = "teacher-flavius-whatsapp-float-styles";
      floatingWhatsappStyles.textContent = [
        ".whatsapp-float{position:fixed;right:24px;bottom:24px;z-index:999;display:inline-flex;align-items:center;gap:10px;min-height:54px;padding:0 18px 0 14px;border-radius:999px;background:#25d366;color:#07140c;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;line-height:1;text-decoration:none;box-shadow:0 14px 35px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.12) inset;transition:transform 180ms ease,box-shadow 180ms ease,background 180ms ease}",
        ".whatsapp-float:hover{transform:translateY(-3px);background:#2ee06f;box-shadow:0 18px 42px rgba(0,0,0,.34),0 0 0 1px rgba(255,255,255,.16) inset}",
        ".whatsapp-float:focus-visible{outline:3px solid #fff;outline-offset:3px}",
        ".whatsapp-float-icon{width:26px;height:26px;flex:0 0 auto}",
        "@media(max-width:640px){.whatsapp-float{right:16px;bottom:16px;width:56px;height:56px;min-height:56px;padding:0;justify-content:center}.whatsapp-float span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.whatsapp-float-icon{width:29px;height:29px}}",
        "@media(prefers-reduced-motion:reduce){.whatsapp-float{transition:none}}"
      ].join("");
      document.head.appendChild(floatingWhatsappStyles);
    }

    document.body.appendChild(floatingWhatsapp);
  }

  function standardizeWhatsappLinks(root) {
    var target = root && root.querySelectorAll ? root : document;
    var whatsappMessage = "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês.";
    target.querySelectorAll('a[href*="wa.me/"], a[href*="api.whatsapp.com/"]').forEach(function (link) {
      try {
        var url = new URL(link.getAttribute("href"), window.location.href);
        var number = "";
        if (url.hostname === "wa.me") number = url.pathname.replace(/\D/g, "");
        else if (url.hostname === "api.whatsapp.com") number = (url.searchParams.get("phone") || "").replace(/\D/g, "");
        if (!number) return;
        link.href = "https://wa.me/" + number + "?text=" + encodeURIComponent(whatsappMessage);
      } catch (error) {
        // Keep the original link if parsing fails.
      }
    });
  }

  function installWhatsappLinkStandardizer() {
    standardizeWhatsappLinks(document);
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && node.matches('a[href*="wa.me/"], a[href*="api.whatsapp.com/"]')) {
            standardizeWhatsappLinks(node.parentNode || document);
            return;
          }
          standardizeWhatsappLinks(node);
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
      standardizeWhatsappLinks(document);
    });
  }

  function loadPublicPageScripts() {
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
    standardizeWhatsappLinks(document);
    if (!isPublicMarketingPage()) installWhatsappLinkStandardizer();
    installWhatsappFloat();
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
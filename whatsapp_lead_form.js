(function () {
  "use strict";

  if (window.__teacherWhatsappLeadFormBootstrapLoaded) return;
  window.__teacherWhatsappLeadFormBootstrapLoaded = true;

  var FLOATING_BUTTON_ID = "teacher-flavius-whatsapp-float";
  var BYPASS_ATTRIBUTE = "data-tf-whatsapp-form-bypass";
  var CORE_SCRIPT_ID = "teacher-flavius-whatsapp-lead-form-core";
  var CORE_SRC = "/whatsapp_lead_form_core.js?v=20260902-1";
  var coreLoading = false;
  var pendingLink = null;

  function isWhatsappHref(href) {
    if (!href) return false;
    try {
      var url = new URL(href, window.location.href);
      return url.hostname === "wa.me" || url.hostname === "api.whatsapp.com" || /(^|\.)whatsapp\.com$/.test(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function shouldUseForm(link) {
    if (!link || link.id === FLOATING_BUTTON_ID) return false;
    if (link.hasAttribute(BYPASS_ATTRIBUTE)) return false;
    return isWhatsappHref(link.getAttribute("href"));
  }

  function openCore(link) {
    var api = window.TeacherWhatsappLeadForm;
    return !!(api && typeof api.open === "function" && api.open(link));
  }

  function fallbackToWhatsapp(link) {
    if (!link) return;
    var href = link.getAttribute("href");
    if (!href) return;
    window.location.href = href;
  }

  function loadCore(link) {
    pendingLink = link;
    if (openCore(link)) return;
    if (coreLoading) return;

    coreLoading = true;
    var existing = document.getElementById(CORE_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", function () {
        coreLoading = false;
        var target = pendingLink;
        pendingLink = null;
        if (target && !openCore(target)) fallbackToWhatsapp(target);
      }, { once: true });
      existing.addEventListener("error", function () {
        coreLoading = false;
        var target = pendingLink;
        pendingLink = null;
        fallbackToWhatsapp(target);
      }, { once: true });
      return;
    }

    var script = document.createElement("script");
    script.id = CORE_SCRIPT_ID;
    script.src = CORE_SRC;
    script.async = true;
    script.onload = function () {
      coreLoading = false;
      var target = pendingLink;
      pendingLink = null;
      if (target && !openCore(target)) fallbackToWhatsapp(target);
    };
    script.onerror = function () {
      coreLoading = false;
      var target = pendingLink;
      pendingLink = null;
      fallbackToWhatsapp(target);
    };
    document.head.appendChild(script);
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!shouldUseForm(link)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadCore(link);
  }, true);

  window.TeacherWhatsappLeadFormBootstrap = {
    manages: shouldUseForm
  };
})();

(function () {
  "use strict";

  const MEASUREMENT_ID = "G-11V3W5B6TG";
  const GTM_ANALYTICS_READY_EVENT = "tf_analytics_consent_granted";
  const GTM_READY_TIMEOUT_MS = 2000;
  const ANALYTICS_MODULES = [
    {
      id: "teacher-flavius-analytics-utils",
      src: "/analytics_utils.js?v=20260902-gtm-1",
      globalName: "TeacherAnalyticsUtils"
    },
    {
      id: "teacher-flavius-analytics-acquisition",
      src: "/analytics_acquisition.js?v=20260902-gtm-1",
      globalName: "TeacherAnalyticsAcquisition"
    },
    {
      id: "teacher-flavius-analytics-forms",
      src: "/analytics_forms.js?v=20260902-gtm-1",
      globalName: "TeacherAnalyticsForms"
    },
    {
      id: "teacher-flavius-analytics-payments",
      src: "/analytics_payments.js?v=20260902-gtm-1",
      globalName: "TeacherAnalyticsPayments"
    }
  ];

  if (window.TeacherAnalytics) return;

  function ensureDataLayer() {
    window.dataLayer = window.dataLayer || [];
    return window.dataLayer;
  }

  function requireGlobal(name) {
    const value = window[name];
    if (!value) throw new Error(name + " was not initialized.");
    return value;
  }

  function createGtagTransport() {
    return function () {
      ensureDataLayer().push(arguments);
    };
  }

  function ensureGtagTransport() {
    if (typeof window.gtag !== "function") {
      window.gtag = createGtagTransport();
    }
    return window.gtag;
  }

  function loadModule(module, onComplete) {
    if (window[module.globalName]) {
      onComplete();
      return;
    }

    const existing = document.getElementById(module.id);
    if (existing) {
      existing.addEventListener("load", onComplete, { once: true });
      existing.addEventListener("error", onComplete, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = module.id;
    script.src = module.src;
    script.async = false;
    script.addEventListener("load", onComplete, { once: true });
    script.addEventListener("error", onComplete, { once: true });
    document.head.appendChild(script);
  }

  function loadModules(index, onComplete) {
    if (index >= ANALYTICS_MODULES.length) {
      onComplete();
      return;
    }

    loadModule(ANALYTICS_MODULES[index], function () {
      loadModules(index + 1, onComplete);
    });
  }

  function waitForGtmGoogleTag(onReady) {
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      onReady();
    }

    ensureDataLayer().push({
      event: GTM_ANALYTICS_READY_EVENT,
      eventCallback: finish,
      eventTimeout: GTM_READY_TIMEOUT_MS
    });

    window.setTimeout(finish, GTM_READY_TIMEOUT_MS + 250);
  }

  function initializeAnalytics() {
    const utils = requireGlobal("TeacherAnalyticsUtils");
    const acquisition = requireGlobal("TeacherAnalyticsAcquisition").capture();
    const gtag = ensureGtagTransport();

    function baseParams() {
      return {
        site_area: utils.classifyArea(utils.currentPath()),
        page_path: utils.currentPath(),
        first_touch_source: utils.cleanText(acquisition.first && acquisition.first.source, 80),
        first_touch_medium: utils.cleanText(acquisition.first && acquisition.first.medium, 80),
        first_touch_campaign: utils.cleanText(acquisition.first && acquisition.first.campaign, 100),
        last_touch_source: utils.cleanText(acquisition.last && acquisition.last.source, 80),
        last_touch_medium: utils.cleanText(acquisition.last && acquisition.last.medium, 80),
        last_touch_campaign: utils.cleanText(acquisition.last && acquisition.last.campaign, 100)
      };
    }

    function track(eventName, params) {
      const payload = Object.assign({}, baseParams(), params || {});
      gtag("event", eventName, payload);
    }

    function whatsappPosition(element) {
      if (!element) return "unknown";
      if (element.id === "teacher-flavius-whatsapp-float") return "floating_button";
      if (element.closest && element.closest(".hero")) return "hero";
      if (element.closest && element.closest(".final-cta")) return "final_cta";
      if (element.closest && element.closest("#teacher-flavius-site-footer")) return "footer";
      if (element.closest && element.closest(".payment-help")) return "payment_support";
      return "page_link";
    }

    function isWhatsappHref(href) {
      if (!href) return false;

      try {
        const url = new URL(href, window.location.href);
        return (
          url.hostname === "wa.me" ||
          url.hostname === "api.whatsapp.com" ||
          /(^|\.)whatsapp\.com$/.test(url.hostname)
        );
      } catch (_error) {
        return false;
      }
    }

    function handleGlobalClick(event) {
      const target = event.target && event.target.closest
        ? event.target.closest("a[href],button")
        : null;
      if (!target) return;

      if (target.tagName === "A" && isWhatsappHref(target.getAttribute("href"))) {
        track("whatsapp_click", {
          link_position: whatsappPosition(target),
          link_text: utils.cleanText(
            target.textContent || target.getAttribute("aria-label"),
            100
          )
        });
      }

      if (target.id === "homeVideoTrigger") {
        track("video_start", {
          video_provider: "youtube",
          video_title: "Aula gratuita do Teacher Flávio"
        });
      }
    }

    const formInstrumentation = requireGlobal("TeacherAnalyticsForms").create({
      track: track,
      utils: utils
    });
    const paymentInstrumentation = requireGlobal("TeacherAnalyticsPayments").create({
      track: track,
      utils: utils
    });

    window.TeacherAnalytics = Object.freeze({
      measurementId: MEASUREMENT_ID,
      track: track,
      markFormComplete: formInstrumentation.markFormComplete,
      markFormSubmitFailed: formInstrumentation.markFormSubmitFailed,
      getAcquisition: function () {
        return acquisition;
      }
    });

    track("page_view", {
      page_title: document.title || "Teacher Flávio",
      page_location: window.location.origin + utils.currentPath()
    });

    document.addEventListener("click", handleGlobalClick, true);
    formInstrumentation.initialize();
    paymentInstrumentation.initialize();
  }

  loadModules(0, function () {
    waitForGtmGoogleTag(initializeAnalytics);
  });
})();

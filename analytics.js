(function () {
  "use strict";

  const MEASUREMENT_ID = "G-11V3W5B6TG";
  const SCRIPT_ID = "teacher-flavius-google-tag";

  function requireGlobal(name) {
    const value = window[name];
    if (!value) throw new Error(name + " was not initialized.");
    return value;
  }

  const utils = requireGlobal("TeacherAnalyticsUtils");
  const acquisition = requireGlobal("TeacherAnalyticsAcquisition").capture();

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false
  });

  if (!document.getElementById(SCRIPT_ID)) {
    const tag = document.createElement("script");
    tag.id = SCRIPT_ID;
    tag.async = true;
    tag.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(tag);
  }

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
    window.gtag("event", eventName, payload);
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
})();

(function () {
  "use strict";

  var EXPERIMENT_NAME = "cta_copy_v1";
  var VARIANT_KEY = "tf_cro_cta_copy_v1";
  var AI_REFERRAL_KEY = "tf_ai_referral_v1";
  var WHATSAPP_LEAD_KEY = "tf_whatsapp_lead_v1";

  if (window.gtag && window.gtag.__tfAttributionWrapped) return;

  window.dataLayer = window.dataLayer || [];
  var originalGtag = typeof window.gtag === "function" ? window.gtag : null;

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function isSalesPage() {
    return currentPath().indexOf("/curso-de-ingles-online") === 0;
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* Storage may be unavailable. */ }
  }

  function safeSessionGet(key) {
    try { return window.sessionStorage.getItem(key); } catch (error) { return null; }
  }

  function safeSessionSet(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch (error) { /* Storage may be unavailable. */ }
  }

  function clean(value, maxLength) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength || 100);
  }

  function referrerHost() {
    if (!document.referrer) return "";
    try { return new URL(document.referrer).hostname.toLowerCase(); } catch (error) { return ""; }
  }

  function classifyAiAssistant(value) {
    var source = clean(value, 120).toLowerCase();
    if (!source) return "";
    if (source === "chatgpt" || source.indexOf("chatgpt.com") !== -1 || source.indexOf("chat.openai.com") !== -1) return "chatgpt";
    if (source.indexOf("perplexity.ai") !== -1 || source === "perplexity") return "perplexity";
    if (source.indexOf("gemini.google.com") !== -1 || source === "gemini") return "gemini";
    if (source.indexOf("copilot.microsoft.com") !== -1 || source === "copilot") return "copilot";
    if (source.indexOf("claude.ai") !== -1 || source === "claude") return "claude";
    return "";
  }

  function currentAiReferral() {
    var source = "";
    try {
      var params = new URLSearchParams(window.location.search || "");
      source = params.get("utm_source") || params.get("source") || "";
    } catch (error) {
      source = "";
    }

    var assistant = classifyAiAssistant(source) || classifyAiAssistant(referrerHost());
    if (assistant) {
      safeSessionSet(AI_REFERRAL_KEY, assistant);
      return assistant;
    }
    return safeSessionGet(AI_REFERRAL_KEY) || "";
  }

  var aiReferral = currentAiReferral();

  function queryVariantOverride() {
    if (!isSalesPage()) return "";
    try {
      var value = new URLSearchParams(window.location.search || "").get("cro_variant");
      return value === "a" || value === "b" ? value : "";
    } catch (error) {
      return "";
    }
  }

  function getVariant() {
    var override = queryVariantOverride();
    if (override) return override;

    var stored = safeGet(VARIANT_KEY);
    if (stored === "a" || stored === "b") return stored;
    if (!isSalesPage()) return "";

    var assigned = Math.random() < 0.5 ? "a" : "b";
    safeSet(VARIANT_KEY, assigned);
    return assigned;
  }

  function attributionParams() {
    var variant = getVariant();
    return {
      cro_experiment: variant ? EXPERIMENT_NAME : "none",
      cro_variant: variant || "not_exposed",
      traffic_channel: aiReferral ? "ai_assistant" : "standard",
      ai_assistant: aiReferral || "not_set"
    };
  }

  function forward() {
    if (originalGtag) return originalGtag.apply(window, arguments);
    window.dataLayer.push(arguments);
  }

  function wrappedGtag(command, eventName, params) {
    if (command === "event" && typeof eventName === "string") {
      var enriched = Object.assign({}, attributionParams(), params || {});
      if (isSalesPage()) enriched.site_area = "marketing";
      return forward("event", eventName, enriched);
    }
    return forward.apply(null, arguments);
  }

  function isWhatsappHref(href) {
    if (!href) return false;
    try {
      var url = new URL(href, window.location.href);
      return url.hostname === "wa.me" || url.hostname === "api.whatsapp.com" || /(^|\.)whatsapp\.com$/.test(url.hostname);
    } catch (error) {
      return false;
    }
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

  function trackWhatsappLeadOnce(target) {
    if (safeSessionGet(WHATSAPP_LEAD_KEY)) return;
    safeSessionSet(WHATSAPP_LEAD_KEY, "1");

    var params = {
      lead_method: "whatsapp",
      link_position: whatsappPosition(target),
      link_text: clean(target.textContent || target.getAttribute("aria-label"), 100)
    };

    wrappedGtag("event", "generate_lead", params);

    if (aiReferral) {
      wrappedGtag("event", "ai_assistant_lead", params);
      if (aiReferral === "chatgpt") wrappedGtag("event", "chatgpt_lead", params);
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!target || !isWhatsappHref(target.getAttribute("href"))) return;
    trackWhatsappLeadOnce(target);
  }, true);

  wrappedGtag.__tfAttributionWrapped = true;
  window.gtag = wrappedGtag;
  window.TeacherCroAttribution = {
    experiment_name: EXPERIMENT_NAME,
    getVariant: getVariant,
    getParams: attributionParams,
    ai_assistant: aiReferral || "not_set"
  };
})();

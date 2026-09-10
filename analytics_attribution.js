(function () {
  "use strict";

  var EXPERIMENT_NAME = "cta_copy_v1";
  var VARIANT_KEY = "tf_cro_cta_copy_v1";
  var AI_REFERRAL_KEY = "tf_ai_referral_v1";
  var ACQUISITION_SESSION_KEY = "tf_acquisition_session_v1";
  var VISITOR_KEY = "tf_marketing_visitor_v1";
  var SESSION_KEY = "tf_marketing_session_v1";
  var WHATSAPP_CLICK_DEBOUNCE_MS = 1200;
  var COLLECTOR_URL = "https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/marketing-acquisition-event";

  if (window.gtag && window.gtag.__tfAttributionWrapped) return;

  window.dataLayer = window.dataLayer || [];
  var originalGtag = typeof window.gtag === "function" ? window.gtag : null;

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function isSalesPage() {
    return currentPath().indexOf("/curso-de-ingles-online") === 0;
  }

  function isContentPage() {
    var path = currentPath();
    return path.indexOf("/recursos") === 0 || path.indexOf("/sobre") === 0;
  }

  function siteArea() {
    var path = currentPath();
    if (path.indexOf("/recursos") === 0) return "geo_content";
    if (path.indexOf("/sobre") === 0) return "authority";
    if (isSalesPage()) return "marketing";
    if (path === "/") return "marketing_home";
    return "other";
  }

  function isAcquisitionPage() {
    var path = currentPath();
    return path === "/" ||
      path === "/index.html" ||
      path.indexOf("/curso-de-ingles-online") === 0 ||
      path.indexOf("/sobre") === 0 ||
      path.indexOf("/recursos") === 0 ||
      path.indexOf("/quero-conhecer") === 0 ||
      path.indexOf("/quero_conhecer") === 0 ||
      path.indexOf("/landing-page") === 0;
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

  function safeJsonParse(value) {
    try { return JSON.parse(value); } catch (error) { return null; }
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

  function normalizeSource(value) {
    var source = clean(value, 120).toLowerCase();
    var assistant = classifyAiAssistant(source);
    if (assistant) return assistant;
    if (/^(www\.)?google\./.test(source) || source === "google") return "google";
    if (/^(www\.)?bing\./.test(source) || source === "bing") return "bing";
    if (source.indexOf("instagram.com") !== -1 || source === "instagram") return "instagram";
    if (source.indexOf("facebook.com") !== -1 || source.indexOf("fb.com") !== -1 || source === "facebook") return "facebook";
    return source.replace(/^www\./, "") || "direct";
  }

  function defaultMedium(source) {
    if (source === "direct") return "none";
    if (classifyAiAssistant(source)) return "referral";
    if (source === "google" || source === "bing") return "organic";
    if (source === "instagram" || source === "facebook") return "social";
    return "referral";
  }

  function trafficChannel(source, medium) {
    var normalizedMedium = clean(medium, 80).toLowerCase();
    if (classifyAiAssistant(source)) return "ai_assistant";
    if (source === "direct") return "direct";
    if (/cpc|ppc|paid|ads?/.test(normalizedMedium)) return "paid_search";
    if (source === "google" || source === "bing") return "organic_search";
    if (source === "instagram" || source === "facebook") return "social";
    if (normalizedMedium === "referral") return "referral";
    return "campaign";
  }

  function currentAcquisition() {
    var stored = safeJsonParse(safeSessionGet(ACQUISITION_SESSION_KEY));
    var params;
    try { params = new URLSearchParams(window.location.search || ""); } catch (error) { params = new URLSearchParams(); }

    var explicitSource = clean(params.get("utm_source") || params.get("source"), 80);
    var explicitMedium = clean(params.get("utm_medium"), 80);
    var campaign = clean(params.get("utm_campaign"), 100);
    var refHost = referrerHost();
    var ownHost = (window.location.hostname || "").toLowerCase();
    var externalReferrer = refHost && refHost !== ownHost && refHost !== "www." + ownHost;

    if (!explicitSource && !externalReferrer && stored && stored.source) return stored;

    var source = explicitSource ? normalizeSource(explicitSource) : externalReferrer ? normalizeSource(refHost) : "direct";
    var medium = explicitMedium || defaultMedium(source);
    var acquisition = {
      source: source,
      medium: medium,
      campaign: campaign || "not_set",
      traffic_channel: trafficChannel(source, medium),
      ai_assistant: classifyAiAssistant(source) || "",
      landing_page: currentPath()
    };
    safeSessionSet(ACQUISITION_SESSION_KEY, JSON.stringify(acquisition));
    return acquisition;
  }

  var acquisition = currentAcquisition();
  var aiReferral = acquisition.ai_assistant || safeSessionGet(AI_REFERRAL_KEY) || "";
  if (aiReferral) safeSessionSet(AI_REFERRAL_KEY, aiReferral);

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function getVisitorId() {
    var id = safeGet(VISITOR_KEY);
    if (id) return id;
    id = randomUuid();
    safeSet(VISITOR_KEY, id);
    return id;
  }

  function getSessionId() {
    var id = safeSessionGet(SESSION_KEY);
    if (id) return id;
    id = randomUuid();
    safeSessionSet(SESSION_KEY, id);
    return id;
  }

  var visitorId = getVisitorId();
  var sessionId = getSessionId();
  var lastWhatsappLeadAt = 0;

  function queueFirstPartyPayload(payload, useBeacon) {
    var body = JSON.stringify(payload);

    if (useBeacon && navigator && typeof navigator.sendBeacon === "function") {
      try {
        if (navigator.sendBeacon(COLLECTOR_URL, body)) return;
      } catch (error) {
        /* Fall back to fetch below. */
      }
    }

    try {
      window.fetch(COLLECTOR_URL, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive: useBeacon,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: body
      }).catch(function () { /* First-party analytics must never block the page. */ });
    } catch (error) {
      /* First-party analytics must never block the page. */
    }
  }

  function sendFirstPartyEvent(eventName, params) {
    if (!isAcquisitionPage()) return;
    var payload = Object.assign({
      event_id: randomUuid(),
      event_name: eventName,
      visitor_id: visitorId,
      session_id: sessionId,
      source: acquisition.source,
      medium: acquisition.medium,
      campaign: acquisition.campaign,
      traffic_channel: acquisition.traffic_channel,
      ai_assistant: aiReferral || null,
      page_path: currentPath(),
      landing_page: acquisition.landing_page || currentPath(),
      occurred_at: new Date().toISOString()
    }, params || {});

    queueFirstPartyPayload(payload, eventName === "generate_lead");
  }

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
      traffic_channel: acquisition.traffic_channel,
      ai_assistant: aiReferral || "not_set",
      site_area: siteArea(),
      geo_content: isContentPage() ? "yes" : "no"
    };
  }

  function forward() {
    if (originalGtag) return originalGtag.apply(window, arguments);
    window.dataLayer.push(arguments);
  }

  function wrappedGtag(command, eventName, params) {
    if (command === "event" && typeof eventName === "string") {
      var enriched = Object.assign({}, attributionParams(), params || {});
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

  function shouldTrackWhatsappLead() {
    var now = Date.now();
    if (now - lastWhatsappLeadAt < WHATSAPP_CLICK_DEBOUNCE_MS) return false;
    lastWhatsappLeadAt = now;
    return true;
  }

  function trackWhatsappLead(target) {
    if (!shouldTrackWhatsappLead()) return;

    var params = {
      lead_method: "whatsapp",
      link_position: whatsappPosition(target),
      link_text: clean(target.textContent || target.getAttribute("aria-label"), 100)
    };

    wrappedGtag("event", "generate_lead", params);
    sendFirstPartyEvent("generate_lead", { link_position: params.link_position });

    if (aiReferral) {
      wrappedGtag("event", "ai_assistant_lead", params);
      if (aiReferral === "chatgpt") wrappedGtag("event", "chatgpt_lead", params);
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!target || !isWhatsappHref(target.getAttribute("href"))) return;
    trackWhatsappLead(target);
  }, true);

  wrappedGtag.__tfAttributionWrapped = true;
  window.gtag = wrappedGtag;
  window.TeacherCroAttribution = {
    experiment_name: EXPERIMENT_NAME,
    getVariant: getVariant,
    getParams: attributionParams,
    ai_assistant: aiReferral || "not_set",
    acquisition: acquisition,
    site_area: siteArea()
  };

  sendFirstPartyEvent("page_view");
})();
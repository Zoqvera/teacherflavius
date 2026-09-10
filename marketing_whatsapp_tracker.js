(function () {
  "use strict";

  if (window.__tfMarketingWhatsappTrackerLoaded) return;
  window.__tfMarketingWhatsappTrackerLoaded = true;

  var VISITOR_KEY = "tf_marketing_visitor_v1";
  var SESSION_KEY = "tf_marketing_session_v1";
  var ACQUISITION_SESSION_KEY = "tf_acquisition_session_v1";
  var TRACKING_EXCLUDED_KEY = "tf_marketing_tracking_excluded_v1";
  var COLLECTOR_URL = "https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/marketing-acquisition-event";
  var CLICK_DEBOUNCE_MS = 1200;
  var lastTrackedAt = 0;

  function safeLocalGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeLocalSet(key, value) {
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

  function randomUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") window.crypto.getRandomValues(bytes);
    else for (var index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function getOrCreateId(storageGet, storageSet, key) {
    var id = storageGet(key);
    if (id) return id;
    id = randomUuid();
    storageSet(key, id);
    return id;
  }

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function classifyAiAssistant(value) {
    var source = clean(value, 120).toLowerCase();
    if (source === "chatgpt" || source.indexOf("chatgpt.com") !== -1 || source.indexOf("chat.openai.com") !== -1) return "chatgpt";
    if (source === "perplexity" || source.indexOf("perplexity.ai") !== -1) return "perplexity";
    if (source === "gemini" || source.indexOf("gemini.google.com") !== -1) return "gemini";
    if (source === "copilot" || source.indexOf("copilot.microsoft.com") !== -1) return "copilot";
    if (source === "claude" || source.indexOf("claude.ai") !== -1) return "claude";
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

  function externalReferrerHost() {
    if (!document.referrer) return "";
    try {
      var referrer = new URL(document.referrer);
      var ownHost = (window.location.hostname || "").toLowerCase();
      var refHost = referrer.hostname.toLowerCase();
      return refHost && refHost !== ownHost && refHost !== "www." + ownHost ? refHost : "";
    } catch (error) {
      return "";
    }
  }

  function resolveAcquisition() {
    var stored = safeJsonParse(safeSessionGet(ACQUISITION_SESSION_KEY));
    var params;
    try { params = new URLSearchParams(window.location.search || ""); } catch (error) { params = new URLSearchParams(); }

    var explicitSource = clean(params.get("utm_source") || params.get("source"), 80);
    var explicitMedium = clean(params.get("utm_medium"), 80);
    var campaign = clean(params.get("utm_campaign"), 100);
    var referrerHost = externalReferrerHost();

    if (!explicitSource && !referrerHost && stored && stored.source) return stored;

    var source = explicitSource ? normalizeSource(explicitSource) : referrerHost ? normalizeSource(referrerHost) : "direct";
    var medium = explicitMedium || defaultMedium(source);
    var acquisition = {
      source: source,
      medium: medium,
      campaign: campaign || "not_set",
      traffic_channel: trafficChannel(source, medium),
      ai_assistant: classifyAiAssistant(source) || null,
      landing_page: currentPath()
    };
    safeSessionSet(ACQUISITION_SESSION_KEY, JSON.stringify(acquisition));
    return acquisition;
  }

  function isWhatsappLink(link) {
    if (!link) return false;
    try {
      var url = new URL(link.getAttribute("href") || "", window.location.href);
      return url.hostname === "wa.me" || url.hostname === "api.whatsapp.com" || /(^|\.)whatsapp\.com$/.test(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function linkPosition(link) {
    if (link.id === "teacher-flavius-whatsapp-float") return "floating_button";
    if (link.closest && link.closest(".hero")) return "hero";
    if (link.closest && link.closest(".final-cta")) return "final_cta";
    if (link.closest && link.closest("#teacher-flavius-site-footer")) return "footer";
    if (link.closest && link.closest(".payment-help")) return "payment_support";
    return "page_link";
  }

  function shouldSendOperationalEvent() {
    if (safeLocalGet(TRACKING_EXCLUDED_KEY) === "1") return false;
    if (window.TeacherCroAttribution) return false;
    var now = Date.now();
    if (now - lastTrackedAt < CLICK_DEBOUNCE_MS) return false;
    lastTrackedAt = now;
    return true;
  }

  function sendPayload(payload) {
    var body = JSON.stringify(payload);
    if (navigator && typeof navigator.sendBeacon === "function") {
      try { if (navigator.sendBeacon(COLLECTOR_URL, body)) return; } catch (error) { /* Fall through. */ }
    }

    try {
      window.fetch(COLLECTOR_URL, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: body
      }).catch(function () { /* Tracking must never block navigation. */ });
    } catch (error) {
      /* Tracking must never block navigation. */
    }
  }

  function trackWhatsappClick(link) {
    if (!shouldSendOperationalEvent()) return;

    var acquisition = resolveAcquisition();
    sendPayload({
      event_id: randomUuid(),
      event_name: "generate_lead",
      visitor_id: getOrCreateId(safeLocalGet, safeLocalSet, VISITOR_KEY),
      session_id: getOrCreateId(safeSessionGet, safeSessionSet, SESSION_KEY),
      source: acquisition.source,
      medium: acquisition.medium,
      campaign: acquisition.campaign,
      traffic_channel: acquisition.traffic_channel,
      ai_assistant: acquisition.ai_assistant,
      page_path: currentPath(),
      landing_page: acquisition.landing_page || currentPath(),
      link_position: linkPosition(link),
      occurred_at: new Date().toISOString()
    });
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link || !isWhatsappLink(link)) return;
    trackWhatsappClick(link);
  }, true);
})();

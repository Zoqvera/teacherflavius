(function () {
  "use strict";

  const ENDPOINT = "https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/app-error-report";
  const nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const script = document.currentScript;
  const pageStatus = script && script.dataset ? script.dataset.pageStatus : "";
  const recent = new Map();
  let minuteStartedAt = Date.now();
  let sentThisMinute = 0;

  function text(value, fallback) {
    if (value instanceof Error) return value.message || fallback || "Erro sem mensagem";
    if (typeof value === "string" && value.trim()) return value.trim();
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch (error) {}
    return fallback || "Erro sem mensagem";
  }

  function cleanUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(String(value), window.location.href);
      return url.origin + url.pathname;
    } catch (error) {
      return String(value).split(/[?#]/, 1)[0].slice(0, 1000);
    }
  }

  function requestInfo(input, init) {
    try {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const parsed = new URL(url, window.location.href);
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      return { url: parsed, method: method };
    } catch (error) {
      return null;
    }
  }

  function classifyRequest(url) {
    const path = url.pathname || "";
    if (path.indexOf("/auth/v1/") !== -1) return "auth";
    if (/\/functions\/v1\/(create-mercado-pago-payment|reconcile-mercado-pago-payments|mercado-pago-webhook)/.test(path)) return "payment";
    return "api";
  }

  function shouldMonitor(url) {
    if (!url) return false;
    if (url.href.indexOf(ENDPOINT) === 0) return false;
    return url.origin === window.location.origin || url.hostname.endsWith(".supabase.co");
  }

  function rateAllowed() {
    const now = Date.now();
    if (now - minuteStartedAt >= 60000) {
      minuteStartedAt = now;
      sentThisMinute = 0;
    }
    if (sentThisMinute >= 20) return false;
    sentThisMinute += 1;
    return true;
  }

  function dedupeAllowed(payload) {
    const now = Date.now();
    const key = [payload.event_type, payload.message, payload.source, payload.http_status, payload.error_code].join("|");
    const previous = recent.get(key) || 0;
    if (now - previous < 30000) return false;
    recent.set(key, now);
    if (recent.size > 100) {
      for (const [candidate, timestamp] of recent) {
        if (now - timestamp > 120000) recent.delete(candidate);
      }
    }
    return true;
  }

  function normalize(payload) {
    const error = payload && payload.error instanceof Error ? payload.error : null;
    return {
      event_type: payload.event_type || "client_exception",
      severity: payload.severity || "error",
      message: text(payload.message || error, "Erro no navegador"),
      source: cleanUrl(payload.source || (error && error.fileName) || window.location.href),
      path: window.location.pathname,
      stack: payload.stack || (error && error.stack) || null,
      error_code: payload.error_code || null,
      http_status: payload.http_status || null,
      http_method: payload.http_method || null,
      metadata: Object.assign({ online: navigator.onLine }, payload.metadata || {}),
      occurred_at: new Date().toISOString()
    };
  }

  function capture(payload) {
    if (!nativeFetch || !payload) return;
    const normalized = normalize(payload);
    if (!rateAllowed() || !dedupeAllowed(normalized)) return;
    try {
      void nativeFetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
        keepalive: true,
        credentials: "omit",
        cache: "no-store"
      }).catch(function () {});
    } catch (error) {}
  }

  function captureException(error, metadata) {
    capture({ event_type: "client_exception", error: error, metadata: metadata || {} });
  }

  function capturePaymentError(error, phase) {
    capture({
      event_type: "payment",
      error: error,
      metadata: { phase: phase || "payment", provider: "mercado_pago" }
    });
  }

  window.addEventListener("error", function (event) {
    if (event instanceof ErrorEvent) {
      capture({
        event_type: "javascript",
        message: event.message,
        error: event.error,
        source: event.filename,
        stack: event.error && event.error.stack
      });
      return;
    }
    const target = event.target;
    if (target && target !== window) {
      capture({
        event_type: "resource",
        message: "Falha ao carregar recurso " + String(target.tagName || "desconhecido").toLowerCase(),
        source: target.src || target.href || window.location.href,
        metadata: { resource_tag: String(target.tagName || "unknown").toLowerCase() }
      });
    }
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    const reason = event.reason;
    capture({
      event_type: "unhandled_promise",
      message: text(reason, "Promise rejeitada sem tratamento"),
      error: reason instanceof Error ? reason : null,
      stack: reason instanceof Error ? reason.stack : null
    });
  });

  if (nativeFetch) {
    window.fetch = function (input, init) {
      const info = requestInfo(input, init);
      const startedAt = performance.now();
      return nativeFetch(input, init).then(function (response) {
        if (info && shouldMonitor(info.url) && response.status >= 400) {
          const eventType = classifyRequest(info.url);
          const cloned = response.clone();
          void (async function () {
            let message = "HTTP " + response.status + " em " + info.url.pathname;
            let errorCode = null;
            try {
              const contentType = cloned.headers.get("content-type") || "";
              if (contentType.indexOf("json") !== -1) {
                const body = await cloned.json();
                if (body && typeof body === "object") {
                  message = body.message || body.error_description || body.error || message;
                  errorCode = body.code || body.error_code || null;
                }
              }
            } catch (error) {}
            capture({
              event_type: eventType,
              message: message,
              source: info.url.href,
              error_code: errorCode,
              http_status: response.status,
              http_method: info.method,
              metadata: { phase: "http_response" }
            });
          })();
        }
        return response;
      }).catch(function (error) {
        if (info && shouldMonitor(info.url)) {
          capture({
            event_type: classifyRequest(info.url),
            message: text(error, "Falha de rede em " + info.url.pathname),
            error: error,
            source: info.url.href,
            http_method: info.method,
            metadata: { phase: "network", online: navigator.onLine }
          });
        }
        throw error;
      }).finally(function () {
        void startedAt;
      });
    };
  }

  if (pageStatus === "404") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        capture({ event_type: "not_found", severity: "warning", message: "Página 404 acessada", source: window.location.href });
      }, { once: true });
    } else {
      capture({ event_type: "not_found", severity: "warning", message: "Página 404 acessada", source: window.location.href });
    }
  }

  const STANDARD_WHATSAPP_MESSAGE = "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês.";

  function standardizeWhatsappLinks(root) {
    const target = root && root.querySelectorAll ? root : document;
    target.querySelectorAll('a[href*="wa.me/"], a[href*="api.whatsapp.com/"]').forEach(function (link) {
      try {
        const url = new URL(link.getAttribute("href"), window.location.href);
        let number = "";
        if (url.hostname === "wa.me") {
          number = url.pathname.replace(/\D/g, "");
        } else if (url.hostname === "api.whatsapp.com") {
          number = (url.searchParams.get("phone") || "").replace(/\D/g, "");
        }
        if (!number) return;
        link.href = "https://wa.me/" + number + "?text=" + encodeURIComponent(STANDARD_WHATSAPP_MESSAGE);
      } catch (error) {}
    });
  }

  function installWhatsappStandardizer() {
    standardizeWhatsappLinks(document);
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && node.matches('a[href*="wa.me/"], a[href*="api.whatsapp.com/"]')) {
            standardizeWhatsappLinks(node.parentNode || document);
          } else {
            standardizeWhatsappLinks(node);
          }
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installWhatsappStandardizer, { once: true });
  } else {
    installWhatsappStandardizer();
  }

  window.TeacherFlaviusErrorMonitor = {
    capture: capture,
    captureException: captureException,
    capturePaymentError: capturePaymentError
  };
})();

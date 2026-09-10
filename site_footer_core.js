(function () {
  "use strict";

  const RENDERER_SCRIPT_SELECTOR = 'script[src*="site_footer_renderer.js"]';
  const RENDERER_SCRIPT_SRC = "/site_footer_renderer.js?v=20260902-1";
  const PAYMENT_NOTICE_LOADER_SCRIPT_ID = "teacher-flavius-payment-notice-loader-script";
  const PAYMENT_NOTICE_LOADER_SCRIPT_SRC = "/student_payment_notice_loader.js?v=20260902-1";

  function rendererIsReady() {
    return !!window.SiteFooterRenderer;
  }

  function ensureRenderer() {
    if (rendererIsReady()) return Promise.resolve(true);
    if (!window.ResourceWaiter || typeof window.ResourceWaiter.loadScript !== "function") {
      return Promise.resolve(false);
    }

    return window.ResourceWaiter.loadScript({
      selector: RENDERER_SCRIPT_SELECTOR,
      src: RENDERER_SCRIPT_SRC,
      isReady: rendererIsReady
    });
  }

  function loadBehaviorScript(id, src) {
    if (!document.body || document.getElementById(id)) return;

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    document.body.appendChild(script);
  }

  function loadPaymentNoticeBehavior() {
    loadBehaviorScript(PAYMENT_NOTICE_LOADER_SCRIPT_ID, PAYMENT_NOTICE_LOADER_SCRIPT_SRC);
  }

  function adaptFlexHost() {
    const bodyStyle = window.getComputedStyle(document.body);
    if (bodyStyle.display.indexOf("flex") !== -1 && bodyStyle.flexDirection.indexOf("row") === 0) {
      document.body.classList.add("tf-footer-flex-host");
    }
  }

  async function mountFooter() {
    if (!document.body) return;

    const rendererReady = await ensureRenderer();
    if (!rendererReady) return;

    const footerId = window.SiteFooterRenderer.footerId;
    if (!document.getElementById(footerId)) {
      window.SiteFooterRenderer.installStyles();
      adaptFlexHost();
      document.body.appendChild(window.SiteFooterRenderer.buildFooter());
    }

    loadPaymentNoticeBehavior();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountFooter, { once: true });
  } else {
    mountFooter();
  }
})();

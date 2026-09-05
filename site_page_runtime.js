(function () {
  "use strict";

  const ONLINE_WORD_PATTERN = /\bonline\b/gi;
  const TEXT_ATTRIBUTE_NAMES = ["alt", "aria-label", "placeholder", "title"];
  const SKIPPED_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  function assertFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError("SitePageRuntime requer " + name + ".");
    }
  }

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== "object") {
      throw new TypeError("SitePageRuntime requer dependências de inicialização.");
    }
    if (!dependencies.runtimeConfig || !dependencies.runtimeConfig.scriptAssets) {
      throw new Error("SitePageRuntime requer runtimeConfig válido.");
    }
    assertFunction(dependencies.loadScriptAsset, "loadScriptAsset");
    assertFunction(dependencies.loadStylesheetAsset, "loadStylesheetAsset");
  }

  function replaceOnlineWord(value) {
    if (typeof value !== "string" || !value) return value;
    return value.replace(ONLINE_WORD_PATTERN, "pela internet");
  }

  function replaceJsonStrings(value) {
    if (Array.isArray(value)) return value.map(replaceJsonStrings);
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        value[key] = replaceJsonStrings(value[key]);
      });
      return value;
    }
    if (typeof value !== "string") return value;
    if (/^(?:https?:\/\/|\/)/i.test(value)) return value;
    return replaceOnlineWord(value);
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    const runtimeConfig = deps.runtimeConfig;
    const scriptAssets = runtimeConfig.scriptAssets;
    const stylesheetAssets = runtimeConfig.stylesheetAssets;
    const windowRef = deps.windowRef || window;
    const documentRef = deps.documentRef || document;
    let publicCopyObserver = null;

    function pageContext() {
      return windowRef.SitePageContext;
    }

    function normalizeTextNode(node) {
      if (!node || typeof node.nodeValue !== "string") return;
      const parent = node.parentElement;
      if (parent && SKIPPED_TEXT_TAGS.has(parent.tagName)) return;
      const normalized = replaceOnlineWord(node.nodeValue);
      if (normalized !== node.nodeValue) node.nodeValue = normalized;
    }

    function normalizeTextNodes(root) {
      if (!root || typeof documentRef.createTreeWalker !== "function") return;
      const nodeFilter = windowRef.NodeFilter;
      if (!nodeFilter || typeof nodeFilter.SHOW_TEXT !== "number") return;

      const walker = documentRef.createTreeWalker(root, nodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        normalizeTextNode(node);
        node = walker.nextNode();
      }
    }

    function normalizeElementAttributes(root) {
      if (!root || typeof root.querySelectorAll !== "function") return;
      const selector = TEXT_ATTRIBUTE_NAMES.map(function (name) {
        return "[" + name + "]";
      }).join(",");

      root.querySelectorAll(selector).forEach(function (element) {
        TEXT_ATTRIBUTE_NAMES.forEach(function (name) {
          if (!element.hasAttribute(name)) return;
          const current = element.getAttribute(name);
          const normalized = replaceOnlineWord(current);
          if (normalized !== current) element.setAttribute(name, normalized);
        });
      });
    }

    function normalizeMetaContent() {
      if (typeof documentRef.querySelectorAll !== "function") return;
      documentRef.querySelectorAll("meta[content]").forEach(function (element) {
        const current = element.getAttribute("content");
        if (!current || /^(?:https?:\/\/|\/)/i.test(current)) return;
        const normalized = replaceOnlineWord(current);
        if (normalized !== current) element.setAttribute("content", normalized);
      });
    }

    function normalizeStructuredData() {
      if (typeof documentRef.querySelectorAll !== "function") return;
      documentRef.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
        try {
          const data = JSON.parse(script.textContent || "");
          const normalized = JSON.stringify(replaceJsonStrings(data));
          if (normalized !== script.textContent) script.textContent = normalized;
        } catch (error) {
          console.warn("Não foi possível normalizar os dados estruturados da página.", error);
        }
      });
    }

    function normalizePublicCopy(root) {
      const target = root || documentRef.documentElement;
      if (!target) return;
      normalizeTextNodes(target);
      normalizeElementAttributes(target);
      normalizeMetaContent();
      normalizeStructuredData();
    }

    function observePublicCopy() {
      if (!windowRef.MutationObserver || !documentRef.documentElement || publicCopyObserver) return;
      publicCopyObserver = new windowRef.MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          if (mutation.type === "characterData") {
            normalizeTextNode(mutation.target);
            return;
          }
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType === 3) {
              normalizeTextNode(node);
              return;
            }
            normalizePublicCopy(node);
          });
        });
      });
      publicCopyObserver.observe(documentRef.documentElement, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    function loadAccessibility() {
      deps.loadStylesheetAsset(stylesheetAssets.accessibility);
      deps.loadScriptAsset(scriptAssets.accessibility);
    }

    function loadMobileTopNavigation() {
      deps.loadScriptAsset(scriptAssets.mobileTopNavigation);
    }

    function loadOperationalMarketingTracking() {
      deps.loadScriptAsset(scriptAssets.marketingWhatsappTracker);
    }

    function initializeEnrollmentGuard() {
      const enrollmentGuard = windowRef.SiteEnrollmentGuard;
      if (!enrollmentGuard) return;
      enrollmentGuard.initialize({
        watchDynamicLinks: !pageContext().isPublicMarketingPage()
      });
    }

    function initializeWhatsappUi() {
      const watchDynamicLinks = !pageContext().isPublicMarketingPage();
      deps.loadScriptAsset(scriptAssets.siteWhatsapp, function () {
        if (!windowRef.SiteWhatsapp) return;
        windowRef.SiteWhatsapp.initialize({ watchDynamicLinks: watchDynamicLinks });
      });
    }

    function refreshFooterLinks() {
      if (windowRef.SiteEnrollmentGuard) {
        windowRef.SiteEnrollmentGuard.removeLinks(documentRef);
      }
      if (windowRef.SiteWhatsapp) {
        windowRef.SiteWhatsapp.standardizeLinks(documentRef);
      }
    }

    function loadFooterCore() {
      deps.loadScriptAsset(scriptAssets.footerCore, refreshFooterLinks);
    }

    function loadPublicPageScripts() {
      if (pageContext().currentPath() === "/") {
        loadFooterCore();
        return;
      }
      if (pageContext().isGeoContentPage()) {
        deps.loadScriptAsset(scriptAssets.cleanUrls);
        return;
      }
      deps.loadScriptAsset(scriptAssets.cleanUrls, loadFooterCore);
    }

    function loadPortalScripts() {
      deps.loadScriptAsset(scriptAssets.cleanUrls, function () {
        deps.loadScriptAsset(scriptAssets.googleOnlyAccess, function () {
          deps.loadScriptAsset(scriptAssets.studentBirthdays, loadFooterCore);
        });
      });
    }

    function initializeUi() {
      if (pageContext().isPublicMarketingPage()) {
        normalizePublicCopy();
        observePublicCopy();
      }
      if (windowRef.SiteBranding) windowRef.SiteBranding.install();
      loadAccessibility();
      if (!pageContext().isHomePage()) loadMobileTopNavigation();
      initializeEnrollmentGuard();
      initializeWhatsappUi();
    }

    function schedulePublicScripts() {
      if ("requestIdleCallback" in windowRef) {
        windowRef.requestIdleCallback(loadPublicPageScripts, {
          timeout: runtimeConfig.publicScriptsIdleTimeoutMs
        });
        return;
      }
      windowRef.setTimeout(loadPublicPageScripts, 0);
    }

    function initializeResolvedRuntime() {
      if (!pageContext() || !windowRef.SiteBranding || !windowRef.SiteEnrollmentGuard) return;

      if (documentRef.readyState === "loading") {
        documentRef.addEventListener("DOMContentLoaded", initializeUi, { once: true });
      } else {
        initializeUi();
      }

      if (pageContext().isPublicMarketingPage()) {
        loadOperationalMarketingTracking();
        schedulePublicScripts();
      } else {
        loadPortalScripts();
      }
    }

    function loadSiteFoundations() {
      deps.loadScriptAsset(scriptAssets.sitePageContext, function () {
        if (!windowRef.SitePageContext) return;
        deps.loadScriptAsset(scriptAssets.siteBranding, function () {
          if (!windowRef.SiteBranding) return;
          deps.loadScriptAsset(scriptAssets.siteEnrollmentGuard, initializeResolvedRuntime);
        });
      });
    }

    return Object.freeze({
      initialize: loadSiteFoundations
    });
  }

  window.SitePageRuntime = Object.freeze({
    create: create
  });
})();

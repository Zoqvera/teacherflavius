(function () {
  "use strict";

  const LEGACY_HTML_EXTENSION = ".html";
  let observer = null;

  function isEnrollmentLink(value) {
    if (!value) return false;

    try {
      const url = new URL(value, window.location.href);
      return url.origin === window.location.origin &&
        (url.pathname === "/matricula/" || url.pathname === "/matricula" + LEGACY_HTML_EXTENSION);
    } catch (_error) {
      return false;
    }
  }

  function removeLinks(root) {
    const target = root && root.querySelectorAll ? root : document;
    target.querySelectorAll("a[href]").forEach(function (link) {
      if (isEnrollmentLink(link.getAttribute("href"))) link.remove();
    });
  }

  function handleAddedNode(node) {
    if (!node || node.nodeType !== 1) return;

    if (node.matches && node.matches("a[href]") && isEnrollmentLink(node.getAttribute("href"))) {
      node.remove();
      return;
    }

    removeLinks(node);
  }

  function observeDynamicLinks() {
    if (observer) return;

    observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(handleAddedNode);
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function initialize(options) {
    const settings = options || {};
    removeLinks(document);
    if (settings.watchDynamicLinks) observeDynamicLinks();
  }

  window.SiteEnrollmentGuard = Object.freeze({
    initialize: initialize,
    isEnrollmentLink: isEnrollmentLink,
    removeLinks: removeLinks
  });
})();

(function () {
  "use strict";

  const LEGACY_HTML_EXTENSION = ".html";

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function legacyPath(basePath) {
    return String(basePath || "") + LEGACY_HTML_EXTENSION;
  }

  function isHomePage(pathname) {
    const path = pathname || currentPath();
    return path === "/" || path === legacyPath("/index");
  }

  function isGeoContentPage(pathname) {
    const path = pathname || currentPath();
    return path.indexOf("/sobre") === 0 || path.indexOf("/recursos") === 0;
  }

  function isSalesPage(pathname) {
    const path = pathname || currentPath();
    return path === "/quero_conhecer" ||
      path === legacyPath("/quero_conhecer") ||
      path === "/quero-conhecer" ||
      path === "/quero-conhecer/" ||
      path.indexOf("/curso-de-ingles-online") === 0 ||
      path.indexOf("/landing-page") === 0;
  }

  function isPublicMarketingPage(pathname) {
    const path = pathname || currentPath();
    return isHomePage(path) ||
      path === "/privacidade" ||
      path === "/privacidade/" ||
      path === "/cookies" ||
      path === "/cookies/" ||
      path === "/termos" ||
      path === "/termos/" ||
      isSalesPage(path) ||
      isGeoContentPage(path);
  }

  window.SitePageContext = Object.freeze({
    currentPath: currentPath,
    isHomePage: isHomePage,
    isGeoContentPage: isGeoContentPage,
    isSalesPage: isSalesPage,
    isPublicMarketingPage: isPublicMarketingPage
  });
})();

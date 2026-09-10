(function () {
  "use strict";

  const BRAND_STYLESHEET_ID = "teacher-flavius-brand-palette";
  const BRAND_STYLESHEET_HREF = "/brand_palette.css?v=20260820-3";
  const THEME_COLOR = "#02102B";
  const LIGHT_TEXT_LUMINANCE_THRESHOLD = 150;

  function requirePageContext() {
    if (!window.SitePageContext) {
      throw new Error("SitePageContext não está disponível para aplicar o branding.");
    }
    return window.SitePageContext;
  }

  function installPaletteStylesheet() {
    let palette = document.getElementById(BRAND_STYLESHEET_ID);
    if (!palette) {
      palette = document.createElement("link");
      palette.id = BRAND_STYLESHEET_ID;
      palette.rel = "stylesheet";
      document.head.appendChild(palette);
    }
    palette.href = BRAND_STYLESHEET_HREF;
  }

  function applyThemeColor() {
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", THEME_COLOR);
  }

  function detectDarkPage(root) {
    if (!document.body) return;

    const bodyColor = window.getComputedStyle(document.body).color || "";
    const rgb = bodyColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!rgb) return;

    const luminance = (Number(rgb[1]) * 0.2126) +
      (Number(rgb[2]) * 0.7152) +
      (Number(rgb[3]) * 0.0722);
    if (luminance >= LIGHT_TEXT_LUMINANCE_THRESHOLD) {
      root.classList.add("tf-brand-dark-page");
    }
  }

  function install() {
    const pageContext = requirePageContext();
    const root = document.documentElement;
    const path = pageContext.currentPath();

    root.classList.add("tf-brand-palette");
    if (pageContext.isHomePage(path)) root.classList.add("tf-brand-home");
    if (pageContext.isSalesPage(path)) root.classList.add("tf-brand-sales");

    applyThemeColor();
    installPaletteStylesheet();
    detectDarkPage(root);
  }

  window.SiteBranding = Object.freeze({
    install: install
  });
})();

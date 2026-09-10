(function () {
  "use strict";

  const FLOAT_ID = "teacher-flavius-whatsapp-float";
  const STYLE_ID = "teacher-flavius-whatsapp-float-styles";
  const LINK_SELECTOR = 'a[href*="wa.me/"], a[href*="api.whatsapp.com/"]';
  const WHATSAPP_NUMBER = "5534998349756";
  const WHATSAPP_MESSAGE = "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês.";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const ICON_PATH = "M16.04 3C9.42 3 4.05 8.25 4.05 14.73c0 2.28.67 4.51 1.94 6.41L4 28.2l7.32-1.91a12.13 12.13 0 0 0 4.71.94h.01c6.61 0 12-5.26 12-11.73C28.04 9 22.65 3 16.04 3Zm0 21.91h-.01a9.86 9.86 0 0 1-4.99-1.35l-.36-.21-4.34 1.13 1.16-4.13-.24-.38a9.38 9.38 0 0 1-1.5-5.24c0-5.21 4.6-9.45 10.27-9.45 5.66 0 10.27 4.24 10.27 9.45 0 5.22-4.61 10.18-10.26 10.18Zm5.63-7.08c-.31-.15-1.82-.88-2.1-.98-.28-.1-.49-.15-.69.15-.2.3-.8.98-.98 1.18-.18.2-.36.22-.67.07-.31-.15-1.3-.47-2.48-1.49-.92-.8-1.53-1.79-1.71-2.09-.18-.3-.02-.46.13-.61.14-.13.31-.35.46-.53.15-.18.2-.3.31-.5.1-.2.05-.38-.03-.53-.08-.15-.69-1.63-.95-2.23-.25-.6-.5-.52-.69-.53h-.59c-.2 0-.54.08-.82.38-.28.3-1.08 1.03-1.08 2.51 0 1.48 1.1 2.91 1.25 3.11.15.2 2.16 3.24 5.23 4.54.73.31 1.3.49 1.75.63.73.23 1.4.2 1.93.12.59-.09 1.82-.73 2.08-1.43.26-.7.26-1.3.18-1.43-.08-.13-.28-.2-.59-.35Z";
  let linkObserver = null;

  function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function buildUrl(number) {
    const phone = normalizePhone(number);
    if (!phone) return "";
    return "https://wa.me/" + phone + "?text=" + encodeURIComponent(WHATSAPP_MESSAGE);
  }

  function createFloatIcon() {
    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("class", "whatsapp-float-icon");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", ICON_PATH);
    svg.appendChild(path);
    return svg;
  }

  function installFloatStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".whatsapp-float{position:fixed;right:24px;bottom:24px;z-index:999;display:inline-flex;align-items:center;gap:10px;min-height:54px;padding:0 18px 0 14px;border-radius:999px;background:#25d366;color:#07140c;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;line-height:1;text-decoration:none;box-shadow:0 14px 35px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.12) inset;transition:transform 180ms ease,box-shadow 180ms ease,background 180ms ease}",
      ".whatsapp-float:hover{transform:translateY(-3px);background:#2ee06f;box-shadow:0 18px 42px rgba(0,0,0,.34),0 0 0 1px rgba(255,255,255,.16) inset}",
      ".whatsapp-float:focus-visible{outline:3px solid #fff;outline-offset:3px}",
      ".whatsapp-float-icon{width:26px;height:26px;flex:0 0 auto}",
      "@media(max-width:640px){.whatsapp-float{right:16px;bottom:16px;width:56px;height:56px;min-height:56px;padding:0;justify-content:center}.whatsapp-float span{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.whatsapp-float-icon{width:29px;height:29px}}",
      "@media(prefers-reduced-motion:reduce){.whatsapp-float{transition:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  function installFloat() {
    if (!document.body || document.getElementById(FLOAT_ID)) return;

    installFloatStyles();
    const link = document.createElement("a");
    link.id = FLOAT_ID;
    link.className = "whatsapp-float";
    link.href = buildUrl(WHATSAPP_NUMBER);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Falar com o Teacher Flávio pelo WhatsApp");
    link.appendChild(createFloatIcon());

    const label = document.createElement("span");
    label.textContent = "Fale no WhatsApp";
    link.appendChild(label);
    document.body.appendChild(link);
  }

  function getPhoneFromUrl(value) {
    const url = new URL(value, window.location.href);
    if (url.hostname === "wa.me") return normalizePhone(url.pathname);
    if (url.hostname === "api.whatsapp.com") return normalizePhone(url.searchParams.get("phone"));
    return "";
  }

  function standardizeLink(link) {
    try {
      const phone = getPhoneFromUrl(link.getAttribute("href"));
      if (!phone) return;
      link.href = buildUrl(phone);
    } catch (_error) {
      // Keep the original link if parsing fails.
    }
  }

  function standardizeLinks(root) {
    const target = root && root.querySelectorAll ? root : document;
    if (target.matches && target.matches(LINK_SELECTOR)) standardizeLink(target);
    target.querySelectorAll(LINK_SELECTOR).forEach(standardizeLink);
  }

  function installLinkStandardizer() {
    if (linkObserver) return;

    linkObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          standardizeLinks(node);
        });
      });
    });
    linkObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function initialize(options) {
    const settings = options || {};
    standardizeLinks(document);
    if (settings.watchDynamicLinks) installLinkStandardizer();
    installFloat();
  }

  window.SiteWhatsapp = Object.freeze({
    buildUrl: buildUrl,
    standardizeLinks: standardizeLinks,
    initialize: initialize
  });
})();

(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root) return;

  root.StudentsOfDayWhatsApp = api;
  if (root.document) api.install(root.document);
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const MESSAGE = "Olá, você tem aula hoje. Você confirma sua participação?";

  function digits(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  function normalizeNumber(value) {
    const number = digits(value);
    if (number.length === 10 || number.length === 11) return "55" + number;
    return number;
  }

  function buildUrl(value) {
    const number = normalizeNumber(value);
    if (number.length < 12 || number.length > 15) return "";
    return "https://wa.me/" + number + "?text=" + encodeURIComponent(MESSAGE);
  }

  function numberFromWhatsappUrl(rawUrl, baseUrl) {
    try {
      const url = new URL(String(rawUrl || ""), baseUrl || "https://teacherflavius.com/");
      if (url.hostname !== "wa.me") return "";
      return digits(url.pathname);
    } catch (_error) {
      return "";
    }
  }

  function refreshLink(anchor) {
    if (!anchor) return "";
    const number = anchor.dataset && anchor.dataset.whatsappNumber
      ? anchor.dataset.whatsappNumber
      : numberFromWhatsappUrl(anchor.getAttribute("href"), anchor.ownerDocument && anchor.ownerDocument.baseURI);
    const url = buildUrl(number);
    if (url) anchor.setAttribute("href", url);
    return url;
  }

  function install(documentRef) {
    if (!documentRef || documentRef.__studentsOfDayWhatsAppInstalled) return;
    documentRef.__studentsOfDayWhatsAppInstalled = true;

    documentRef.addEventListener("click", function (event) {
      const target = event.target && event.target.closest
        ? event.target.closest("a.day-whatsapp-link")
        : null;
      if (!target) return;
      refreshLink(target);
    }, true);
  }

  return Object.freeze({
    MESSAGE: MESSAGE,
    digits: digits,
    normalizeNumber: normalizeNumber,
    buildUrl: buildUrl,
    numberFromWhatsappUrl: numberFromWhatsappUrl,
    refreshLink: refreshLink,
    install: install
  });
});

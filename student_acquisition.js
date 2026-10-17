(function (global) {
  "use strict";

  const SOURCES = Object.freeze([
    { value: "instagram", label: "Instagram" },
    { value: "chatgpt", label: "ChatGPT" },
    { value: "google", label: "Google" },
    { value: "referral", label: "Indicação de amigo ou familiar" },
    { value: "facebook", label: "Facebook" },
    { value: "getninjas", label: "GetNinjas" },
    { value: "other", label: "Outras fontes" },
    { value: "unknown", label: "Não me lembro" }
  ]);
  const LABELS = Object.freeze(Object.fromEntries(SOURCES.map(item => [item.value, item.label])));

  function label(source, detail) {
    if (source === "other" && detail) return "Outro: " + detail;
    return LABELS[source] || "Não informado";
  }

  function setup(selectId, detailId, initialSource, initialDetail) {
    const select = document.getElementById(selectId);
    const detail = document.getElementById(detailId);
    if (!select || !detail) return;
    select.replaceChildren(new Option("Selecione uma opção", ""));
    SOURCES.forEach(item => select.add(new Option(item.label, item.value)));
    select.value = LABELS[initialSource] ? initialSource : "";
    detail.value = initialDetail || "";
    const parent = detail.closest("[data-acquisition-detail]");
    function sync() {
      const isOther = select.value === "other";
      if (parent) parent.hidden = !isOther;
      detail.required = isOther && select.required;
      if (!isOther) detail.value = "";
    }
    select.onchange = sync;
    sync();
  }

  function read(selectId, detailId, required) {
    const select = document.getElementById(selectId);
    const detail = document.getElementById(detailId);
    const source = select ? select.value : "";
    if (!source) {
      if (required) throw new Error("Informe como conheceu as aulas do Teacher Flávio.");
      return { source: null, detail: null };
    }
    if (!LABELS[source]) throw new Error("Selecione uma origem válida.");
    const other = source === "other" ? String(detail && detail.value || "").trim() : "";
    if (source === "other" && !other) throw new Error("Informe onde conheceu as aulas.");
    if (other.length > 120) throw new Error("A descrição da origem deve ter até 120 caracteres.");
    return { source: source, detail: other || null };
  }

  function technicalAttribution() {
    const query = new URLSearchParams(global.location.search);
    let referrerHost = "";
    try { referrerHost = document.referrer ? new URL(document.referrer).hostname : ""; }
    catch (_) { referrerHost = ""; }
    return {
      utm_source: (query.get("utm_source") || "").slice(0, 120),
      utm_medium: (query.get("utm_medium") || "").slice(0, 120),
      utm_campaign: (query.get("utm_campaign") || "").slice(0, 120),
      referrer_host: referrerHost.slice(0, 120)
    };
  }

  global.StudentAcquisition = Object.freeze({
    sources: SOURCES, label: label, setup: setup, read: read,
    technicalAttribution: technicalAttribution
  });
})(window);

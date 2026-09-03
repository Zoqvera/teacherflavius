(function () {
  "use strict";

  const TABLE_NAME = "page_content_overrides";
  const PAGE_KEY_ATTRIBUTE = "data-page-content-key";
  const CONTENT_KEY_ATTRIBUTE = "data-content-key";
  const UPDATED_AT_ATTRIBUTE = "data-content-updated-at";

  function getConfig() {
    const config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) return null;
    return config;
  }

  function getPageKey() {
    const root = document.querySelector("[" + PAGE_KEY_ATTRIBUTE + "]");
    return root ? root.getAttribute(PAGE_KEY_ATTRIBUTE) : "";
  }

  function buildRequestUrl(config, pageKey) {
    const params = new URLSearchParams({
      page_key: "eq." + pageKey,
      select: "content,updated_at",
      limit: "1"
    });
    return config.url + "/rest/v1/" + TABLE_NAME + "?" + params.toString();
  }

  function formatUpdatedDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }

  function applyContent(content) {
    if (!content || typeof content !== "object") return;

    document.querySelectorAll("[" + CONTENT_KEY_ATTRIBUTE + "]").forEach(function (element) {
      const key = element.getAttribute(CONTENT_KEY_ATTRIBUTE);
      const value = content[key];
      if (typeof value === "string" && value.trim()) element.textContent = value;
    });
  }

  function applyUpdatedAt(updatedAt) {
    const target = document.querySelector("[" + UPDATED_AT_ATTRIBUTE + "]");
    if (!target) return;

    const formattedDate = formatUpdatedDate(updatedAt);
    if (formattedDate) target.textContent = formattedDate;
  }

  async function loadOverride() {
    const config = getConfig();
    const pageKey = getPageKey();
    if (!config || !pageKey) return;

    try {
      const response = await fetch(buildRequestUrl(config, pageKey), {
        method: "GET",
        headers: {
          apikey: config.anonKey,
          Authorization: "Bearer " + config.anonKey,
          Accept: "application/json"
        },
        cache: "no-store"
      });

      if (!response.ok) return;

      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) return;

      applyContent(rows[0].content);
      applyUpdatedAt(rows[0].updated_at);
    } catch (error) {
      console.warn("Não foi possível carregar a versão editada do conteúdo.", error);
    }
  }

  loadOverride();
})();

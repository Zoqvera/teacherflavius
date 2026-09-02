(function () {
  "use strict";

  const HTML_EXTENSION = ".html";
  const CLASS_BOARD_FILENAME = "quadro-de-turmas" + HTML_EXTENSION;
  const CLASS_CARD_HREF_FRAGMENT = "turma" + HTML_EXTENSION + "?id=";
  const CLASS_CARD_SELECTOR = '.class-item[href*="' + CLASS_CARD_HREF_FRAGMENT + '"]';

  function isClassBoardPage() {
    return window.location.pathname.endsWith("/" + CLASS_BOARD_FILENAME);
  }

  function getClassTypeVisual(value) {
    if (value === "quartet" || value === "group") {
      return {
        label: "QUARTETO",
        color: "#bfdbfe",
        background: "rgba(59,130,246,.15)",
        border: "rgba(96,165,250,.35)"
      };
    }

    if (value === "individual") {
      return {
        label: "INDIVIDUAL",
        color: "#d8b4fe",
        background: "rgba(168,85,247,.14)",
        border: "rgba(192,132,252,.35)"
      };
    }

    if (value === "eight_students") {
      return {
        label: "8 ALUNOS",
        color: "#a7f3d0",
        background: "rgba(16,185,129,.14)",
        border: "rgba(52,211,153,.35)"
      };
    }

    return {
      label: "TIPO NÃO DEFINIDO",
      color: "#fde68a",
      background: "rgba(245,158,11,.12)",
      border: "rgba(251,191,36,.30)"
    };
  }

  function getClassNumber(card) {
    try {
      return Number(new URL(card.getAttribute("href"), window.location.href).searchParams.get("id"));
    } catch (_error) {
      return Number.NaN;
    }
  }

  function createBadge(typeValue, visual) {
    const badge = document.createElement("span");
    badge.className = "generated-class-type-badge";
    badge.dataset.classType = typeValue;
    badge.textContent = visual.label;
    badge.style.cssText = [
      "display:inline-flex",
      "margin-left:7px",
      "vertical-align:middle",
      "border-radius:999px",
      "padding:3px 7px",
      "font-size:9px",
      "font-weight:bold",
      "letter-spacing:.4px",
      "color:" + visual.color,
      "background:" + visual.background,
      "border:1px solid " + visual.border
    ].join(";") + ";";
    return badge;
  }

  function annotateCard(card, classTypeCache) {
    const generatedBadge = card.querySelector(".generated-class-type-badge");
    const officialBadge = card.querySelector(".class-type-badge");

    if (officialBadge) {
      if (generatedBadge) generatedBadge.remove();
      return;
    }

    const title = card.querySelector(".class-title");
    if (!title) return;

    const classNumber = getClassNumber(card);
    if (!Number.isFinite(classNumber)) return;

    const row = classTypeCache.get(classNumber);
    const typeValue = row && row.class_type ? row.class_type : "unset";
    const existingBadge = title.querySelector(".generated-class-type-badge");

    if (existingBadge && existingBadge.dataset.classType === typeValue) return;
    if (existingBadge) existingBadge.remove();

    const visual = getClassTypeVisual(row ? row.class_type : null);
    title.appendChild(createBadge(typeValue, visual));
  }

  function render(classTypeCache) {
    if (!isClassBoardPage() || !classTypeCache) return;
    document.querySelectorAll(CLASS_CARD_SELECTOR).forEach(function (card) {
      annotateCard(card, classTypeCache);
    });
  }

  window.ClassTypeBadgeRenderer = Object.freeze({
    isClassBoardPage: isClassBoardPage,
    render: render
  });
})();

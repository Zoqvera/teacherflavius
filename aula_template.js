(function () {
  "use strict";

  const script = document.currentScript;
  const data = script ? script.dataset : {};

  function loadAnimationScript() {
    if (document.querySelector('script[src^="animated_cards.js"]')) return;

    const animationScript = document.createElement("script");
    animationScript.src = "animated_cards.js?v=20260427-3";
    animationScript.defer = true;
    document.body.appendChild(animationScript);
  }

  function buildLink(href, icon, label) {
    const target = href && href !== "#" ? ' target="_blank" rel="noopener noreferrer"' : "";
    return '<a class="menu-button" href="' + href + '"' + target + '><span><span class="icon">' + icon + '</span>' + label + '</span><span class="arrow">›</span></a>';
  }

  function getLessonConfig() {
    return {
      day: data.day || "Aula",
      time: data.time || "",
      back: data.back || "/minha-turma/",
      lessonLink: data.lessonLink || "#",
      materialLink: data.materialLink || "#",
      whatsappLink: data.whatsappLink || "#"
    };
  }

  function buildPageMarkup(config) {
    return '<div class="container">' +
      '<div class="top-links">' +
        '<a class="top-link" href="' + config.back + '">' + config.day.toUpperCase() + '</a>' +
        '<a class="top-link" href="/minha-turma/">MINHA TURMA</a>' +
      '</div>' +
      '<div class="header">' +
        '<span class="badge">TEACHER FLÁVIO</span>' +
        '<h1>' + config.day + '<br>' + config.time + '</h1>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="menu-grid">' +
        buildLink(config.lessonLink, "▶️", "ASSISTIR A AULA") +
        buildLink(config.materialLink, "📄", "MATERIAL DA AULA") +
        buildLink(config.whatsappLink, "💬", "GRUPO DE WHATSAPP") +
      '</div>' +
    '</div>';
  }

  function renderLessonPage() {
    const config = getLessonConfig();
    document.body.innerHTML = buildPageMarkup(config);
    loadAnimationScript();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderLessonPage, { once: true });
  } else {
    renderLessonPage();
  }
})();

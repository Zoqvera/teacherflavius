(function () {
  "use strict";

  const CLASS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V7l8-4 8 4v14"></path><path d="M9 21v-6h6v6"></path><path d="M8 9h.01M12 9h.01M16 9h.01M8 12h.01M16 12h.01"></path></svg>';

  function getCapacity(card) {
    const badge = card.querySelector(".class-type-badge");
    if (!badge) return null;
    if (badge.classList.contains("individual")) return 1;
    if (badge.classList.contains("quartet")) return 4;
    if (badge.classList.contains("eight-students")) return 8;
    return null;
  }

  function getStudentCount(card) {
    const meta = card.querySelector(".class-meta");
    if (!meta) return 0;
    const match = String(meta.textContent || "").match(/Alunos inscritos:\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  function enhanceCard(card) {
    if (!(card instanceof Element)) return;

    const icon = card.querySelector(".class-card-title .icon");
    if (icon && icon.dataset.visualIconReady !== "1") {
      icon.innerHTML = CLASS_ICON;
      icon.dataset.visualIconReady = "1";
    }

    const capacity = getCapacity(card);
    if (!capacity) return;

    const count = getStudentCount(card);
    const percent = Math.min(100, Math.max(0, Math.round((count / capacity) * 100)));
    let meter = card.querySelector(".capacity-meter");

    if (!meter) {
      meter = document.createElement("div");
      meter.className = "capacity-meter";
      const meta = card.querySelector(".class-meta");
      if (meta && meta.parentNode) meta.insertAdjacentElement("afterend", meter);
      else card.appendChild(meter);
    }

    meter.classList.toggle("is-near", count < capacity && percent >= 75);
    meter.classList.toggle("is-full", count >= capacity);
    meter.style.setProperty("--capacity-percent", percent + "%");

    const availability = Math.max(0, capacity - count);
    const statusText = count >= capacity
      ? "Turma completa"
      : availability + (availability === 1 ? " vaga disponível" : " vagas disponíveis");

    meter.innerHTML =
      '<div class="capacity-meter-head"><span>Ocupação</span><span>' + count + ' / ' + capacity + ' · ' + statusText + '</span></div>' +
      '<div class="capacity-meter-track" aria-hidden="true"><div class="capacity-meter-fill"></div></div>';
    meter.setAttribute("aria-label", "Ocupação da turma: " + count + " de " + capacity + ". " + statusText + ".");
  }

  function enhanceAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(".class-card")) enhanceCard(scope);
    scope.querySelectorAll(".class-card").forEach(enhanceCard);
  }

  function init() {
    enhanceAll(document);

    const grid = document.getElementById("classesGrid");
    if (!grid) return;

    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) enhanceAll(node);
        });
      });
    });

    observer.observe(grid, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

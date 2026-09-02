(function () {
  "use strict";

  function studentNameFromCard(card) {
    var name = card && card.querySelector(".student-heading strong");
    return name ? name.textContent.trim() : "aluno";
  }

  function enhanceSummary() {
    document.querySelectorAll(".summary-card").forEach(function (card) {
      var label = card.querySelector("span");
      var value = card.querySelector("strong");
      if (!label || !value) return;
      card.setAttribute("aria-label", label.textContent.trim() + ": " + value.textContent.trim());
    });
  }

  function enhanceStudentCard(card, index) {
    var name = studentNameFromCard(card);
    var status = card.querySelector(".exercise-status-pill");
    if (status) {
      status.setAttribute("role", "status");
      status.setAttribute("aria-label", "Situação de " + name + ": " + status.textContent.trim());
    }

    var manage = card.querySelector(".manage-exercises-button");
    var editor = card.querySelector(".exercise-editor");
    if (manage && editor) {
      if (!editor.id) editor.id = "exercise-editor-" + index;
      manage.setAttribute("aria-controls", editor.id);
      manage.setAttribute("aria-expanded", editor.hidden ? "false" : "true");
      manage.setAttribute("aria-label", "Gerenciar exercícios de " + name);
      manage.setAttribute("aria-busy", manage.disabled ? "true" : "false");
      editor.setAttribute("aria-label", "Editor de exercícios de " + name);
    }
  }

  function enhanceEditor(editor) {
    if (!editor || editor.hidden) return;

    var card = editor.closest(".exercise-status-card");
    var name = studentNameFromCard(card);
    editor.setAttribute("role", "region");
    editor.setAttribute("aria-label", "Exercícios de " + name);

    var close = editor.querySelector(".close-exercise-editor-button");
    if (close) close.setAttribute("aria-label", "Fechar editor de exercícios de " + name);

    editor.querySelectorAll(".teacher-exercise-row").forEach(function (row, index) {
      var link = row.querySelector(".teacher-exercise-header a");
      var checkbox = row.querySelector(".teacher-completion-checkbox");
      var date = row.querySelector(".teacher-exercise-date");
      var save = row.querySelector(".save-exercise-button");
      var title = link ? link.textContent.replace(/↗/g, "").trim() : "Exercício " + (index + 1);

      row.setAttribute("aria-label", title + (row.classList.contains("is-completed") ? ", concluído" : ", não concluído"));
      if (link) link.setAttribute("aria-label", "Abrir " + title + " em nova aba");
      if (checkbox) checkbox.setAttribute("aria-label", "Marcar " + title + " como concluído");
      if (date) date.setAttribute("aria-label", "Data e hora de conclusão de " + title);
      if (save) {
        save.setAttribute("aria-label", "Salvar situação de " + title);
        save.setAttribute("aria-busy", save.disabled ? "true" : "false");
      }
    });

    editor.querySelectorAll(".teacher-exercise-save-status").forEach(function (status) {
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
    });
  }

  function enhancePage() {
    document.documentElement.classList.add("tf-brand-palette");

    var status = document.getElementById("adminStatus");
    if (status) {
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
    }

    var list = document.getElementById("exerciseCompletionList");
    if (list) {
      list.setAttribute("aria-live", "polite");
      list.setAttribute("aria-busy", list.textContent.indexOf("Carregando") !== -1 ? "true" : "false");
    }

    var count = document.getElementById("visibleStudentsCount");
    if (count) {
      count.setAttribute("role", "status");
      count.setAttribute("aria-live", "polite");
    }

    var filter = document.getElementById("statusFilter");
    if (filter) filter.setAttribute("aria-label", "Filtrar alunos por situação dos exercícios");

    enhanceSummary();
    document.querySelectorAll(".exercise-status-card").forEach(enhanceStudentCard);
    document.querySelectorAll(".exercise-editor").forEach(enhanceEditor);
  }

  var scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      enhancePage();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhancePage, { once: true });
  } else {
    enhancePage();
  }

  var observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "disabled", "class"]
  });
})();

(function (root) {
  "use strict";

  const LABELS = Object.freeze({ reading: "Reading", grammar: "Grammar" });

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = String(content);
    return node;
  }

  function reviewCard(entry, onReview, onError) {
    const item = element("li", "homework-review-item");
    const id = String(entry.answer_id || "");
    item.appendChild(element("h3", "", "ATIVIDADE " + entry.exercise_number +
      " — " + LABELS[entry.activity_type]));
    item.appendChild(element("p", "", "Questão: " + entry.question_prompt));
    item.appendChild(element("p", "", "Resposta enviada: " + entry.response_text));
    const accepted = Array.isArray(entry.accepted_answers)
      ? entry.accepted_answers.filter(value => typeof value === "string") : [];
    item.appendChild(element("p", "", "Respostas de referência: " +
      (accepted.length ? accepted.join("; ") : "consulte a atividade original")));
    item.appendChild(element("p", "", "Peso da questão: " + entry.question_points));

    const form = element("form", "homework-review-form");
    const scoreLabel = element("label", "", "Nota da resposta (0 a 10)");
    const score = element("input", "homework-review-score");
    score.type = "number";
    score.min = "0";
    score.max = "10";
    score.step = "0.01";
    score.required = true;
    score.setAttribute("aria-label", "Nota da resposta da atividade " + entry.exercise_number);
    scoreLabel.appendChild(score);

    const commentLabel = element("label", "", "Justificativa pedagógica");
    const comment = element("textarea", "homework-review-comment");
    comment.rows = 3;
    comment.minLength = 10;
    comment.maxLength = 1000;
    comment.required = true;
    commentLabel.appendChild(comment);

    const button = element("button", "homework-review-save", "Registrar avaliação");
    button.type = "submit";
    const feedback = element("p", "homework-review-message");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");

    form.append(scoreLabel, commentLabel, button, feedback);
    let saving = false;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (saving) return;
      const grade = Number(score.value);
      if (score.value === "" || !Number.isFinite(grade) || grade < 0 || grade > 10 ||
          comment.value.trim().length < 10 || comment.value.trim().length > 1000) {
        feedback.textContent = "Preencha nota de 0 a 10 e justificativa com 10 a 1.000 caracteres.";
        return;
      }
      saving = true;
      button.disabled = true;
      feedback.textContent = "Salvando avaliação...";
      try {
        const result = await onReview(id, grade, comment.value);
        feedback.textContent = result?.status === "evaluated"
          ? "Nota final da atividade calculada."
          : "Resposta revisada. Outras respostas ainda estão pendentes.";
      } catch (error) {
        feedback.textContent = "Não foi possível registrar a revisão.";
        if (typeof onError === "function") onError(error);
      } finally {
        saving = false;
        button.disabled = false;
      }
    });
    item.appendChild(form);
    return item;
  }

  function render(config) {
    const { mount, records, onReview, onError } = config || {};
    if (!mount || !Array.isArray(records) || typeof onReview !== "function") {
      throw new TypeError("Fila de revisão inválida.");
    }
    const fragment = document.createDocumentFragment();
    if (records.length === 0) {
      fragment.appendChild(element("p", "", "Não há respostas abertas pendentes de revisão."));
    } else {
      const list = element("ol", "homework-review-list");
      for (const entry of records) {
        if (!entry || !LABELS[entry.activity_type] || typeof entry.answer_id !== "string") {
          throw new TypeError("Item de revisão inválido.");
        }
        list.appendChild(reviewCard(entry, onReview, onError));
      }
      fragment.appendChild(list);
    }
    mount.replaceChildren(fragment);
  }

  root.HomeworkTeacherReviewRenderer = Object.freeze({ render: render });
})(window);

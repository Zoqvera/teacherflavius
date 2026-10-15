(function (root) {
  "use strict";

  const TYPE_LABELS = Object.freeze({
    reading: "Reading",
    writing: "Writing",
    grammar: "Grammar"
  });

  function normalizeAnswer(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function acceptedAnswers(question) {
    const key = question && question.answer_key;
    if (!key || typeof key !== "object") return [];
    const candidates = Array.isArray(key.accepted) ? key.accepted :
      key.correct == null ? [] : [key.correct];
    return candidates.map(String).filter(value => value.trim().length > 0);
  }

  function evaluateResponses(questions, responses) {
    if (!Array.isArray(questions) || !Array.isArray(responses) ||
        questions.length !== responses.length) {
      throw new TypeError("Questões e respostas incompatíveis.");
    }
    const results = questions.map(function (question, index) {
      const accepted = acceptedAnswers(question);
      const answer = normalizeAnswer(responses[index]);
      const correct = answer.length > 0 && accepted.some(function (candidate) {
        return normalizeAnswer(candidate) === answer;
      });
      return { correct: correct, graded: accepted.length > 0 };
    });
    const graded = results.filter(result => result.graded);
    const correct = graded.filter(result => result.correct).length;
    return {
      correct: correct,
      total: graded.length,
      score: graded.length ? Math.round(100 * correct / graded.length) / 10 : null,
      results: results
    };
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }

  function appendText(parent, value, className) {
    if (typeof value !== "string" || !value.trim()) return;
    const paragraph = element("p", className, value);
    parent.appendChild(paragraph);
  }

  function appendList(parent, items, className) {
    if (!Array.isArray(items) || items.length === 0) return;
    const list = element("ul", className);
    for (const item of items) {
      if (typeof item !== "string" || !item.trim()) continue;
      list.appendChild(element("li", "", item));
    }
    if (list.childElementCount) parent.appendChild(list);
  }

  function appendContent(container, activityType, content) {
    const mainText = {
      reading: content.passage,
      writing: content.prompt,
      grammar: content.explanation
    }[activityType];
    appendText(container, mainText, "homework-pedagogical-body");
    const guidance = activityType === "writing" ? content.guidelines : content.instructions;
    appendList(container, guidance, "homework-pedagogical-instructions");
    if (activityType === "grammar") {
      if (Array.isArray(content.examples) && content.examples.length) {
        container.appendChild(element("h3", "", "Exemplos"));
        appendList(container, content.examples, "homework-pedagogical-examples");
      }
    }
  }

  function appendQuestion(parent, question, index, activityNumber) {
    const wrapper = element("fieldset", "homework-pedagogical-question");
    const legend = element("legend", "", (index + 1) + ". " + question.prompt);
    wrapper.appendChild(legend);
    let read;
    if (question.question_type === "multiple_choice" &&
        Array.isArray(question.options) && question.options.length > 1) {
      const options = element("div", "homework-pedagogical-options");
      const radios = [];
      for (const option of question.options) {
        const label = element("label", "homework-pedagogical-option");
        const input = element("input");
        input.type = "radio";
        input.name = "homework-preview-" + activityNumber + "-" + index;
        input.value = String(option);
        label.append(input, element("span", "", option));
        options.appendChild(label);
        radios.push(input);
      }
      wrapper.appendChild(options);
      read = () => radios.find(radio => radio.checked)?.value || "";
    } else {
      const label = element("label", "homework-visually-hidden",
        "Resposta da questão " + (index + 1));
      const input = element("input", "homework-pedagogical-input");
      input.type = "text";
      input.autocomplete = "off";
      input.maxLength = 1000;
      input.setAttribute("aria-label", "Resposta da questão " + (index + 1));
      label.appendChild(input);
      wrapper.appendChild(label);
      read = () => input.value;
    }
    const message = element("p", "homework-pedagogical-answer-result");
    message.setAttribute("aria-live", "polite");
    wrapper.appendChild(message);
    parent.appendChild(wrapper);
    return { read: read, message: message };
  }

  function appendQuiz(container, questions, activityNumber) {
    if (!questions.length) {
      appendText(container, "Esta versão ainda não possui questões cadastradas.");
      return;
    }
    const form = element("form", "homework-pedagogical-quiz");
    const fields = questions.map((question, index) =>
      appendQuestion(form, question, index, activityNumber));
    const submit = element("button", "homework-pedagogical-submit",
      "Simular correção");
    submit.type = "submit";
    const summary = element("p", "homework-pedagogical-summary");
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    form.append(submit, summary);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      const results = evaluateResponses(questions, fields.map(field => field.read()));
      fields.forEach(function (field, index) {
        if (!results.results[index].graded) {
          field.message.textContent = "Sem gabarito nesta versão.";
          return;
        }
        field.message.textContent = results.results[index].correct
          ? "Correspondência com o gabarito."
          : "Não corresponde exatamente ao gabarito.";
      });
      summary.textContent = results.total
        ? "Simulação local: " + results.correct + " de " + results.total +
          " respostas correspondentes; nota demonstrativa " +
          results.score.toLocaleString("pt-BR", { minimumFractionDigits: 1 }) +
          "/10. Respostas abertas exigem revisão pedagógica."
        : "Não há gabaritos suficientes para simular uma nota.";
    });
    container.appendChild(form);
  }

  function appendWriting(container) {
    const form = element("form", "homework-pedagogical-writing");
    const label = element("label", "", "Sua produção escrita");
    const text = element("textarea", "homework-pedagogical-textarea");
    text.rows = 10;
    text.maxLength = 12000;
    text.required = true;
    text.placeholder = "Escreva sua resposta em inglês...";
    label.appendChild(text);
    const button = element("button", "homework-pedagogical-submit", "Enviar");
    button.type = "submit";
    const message = element("p", "homework-pedagogical-summary");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    form.append(label, button, message);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      message.textContent = "Pré-visualização: texto não enviado. A correção por IA " +
        "será conectada em etapa posterior; nenhuma nota foi atribuída.";
    });
    container.appendChild(form);
  }

  function appendWritingFeedback(container, feedback) {
    if (!container || !feedback || feedback.source !== "ai" ||
        typeof feedback.corrected_text !== "string" ||
        typeof feedback.original_text !== "string" ||
        typeof feedback.general_comment !== "string" ||
        !Array.isArray(feedback.explanations) ||
        !Number.isFinite(feedback.score) ||
        feedback.score < 0 || feedback.score > 10) {
      throw new TypeError("Feedback de IA inválido.");
    }
    const panel = element("section", "homework-pedagogical-feedback");
    panel.appendChild(element("h3", "", "Correção da produção escrita"));
    appendText(panel, "Nota: " + feedback.score.toLocaleString("pt-BR") + "/10");
    appendText(panel, feedback.general_comment);
    panel.appendChild(element("h4", "", "Texto original"));
    appendText(panel, feedback.original_text, "homework-pedagogical-body");
    panel.appendChild(element("h4", "", "Versão corrigida"));
    appendText(panel, feedback.corrected_text, "homework-pedagogical-body");
    if (feedback.explanations.length) {
      panel.appendChild(element("h4", "", "Explicações"));
      appendList(panel, feedback.explanations, "homework-pedagogical-instructions");
    }
    container.replaceChildren(panel);
  }

  function render(config) {
    const { mount, exercise, version, questions } = config || {};
    if (!mount || !exercise || !version || !Array.isArray(questions) ||
        !TYPE_LABELS[exercise.activity_type]) {
      throw new TypeError("Dados da pré-visualização inválidos.");
    }
    const content = version.content || {};
    const fragment = document.createDocumentFragment();
    const heading = element("div", "homework-pedagogical-heading");
    heading.appendChild(element("p", "homework-pedagogical-kind",
      "ATIVIDADE " + exercise.exercise_number + " — " +
        TYPE_LABELS[exercise.activity_type]));
    heading.appendChild(element("h3", "", exercise.title));
    fragment.appendChild(heading);
    appendText(fragment, "Somente professor: respostas e resultados simulados " +
      "nesta tela não são gravados.", "homework-pedagogical-note");
    appendContent(fragment, exercise.activity_type, content);
    if (exercise.activity_type === "writing") {
      appendWriting(fragment);
    } else {
      appendQuiz(fragment, questions, exercise.exercise_number);
    }
    mount.replaceChildren(fragment);
  }

  root.HomeworkPedagogicalPreview = Object.freeze({
    normalizeAnswer: normalizeAnswer,
    acceptedAnswers: acceptedAnswers,
    evaluateResponses: evaluateResponses,
    render: render,
    appendWritingFeedback: appendWritingFeedback
  });
})(window);

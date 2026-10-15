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


  function countWords(value) {
    const words = String(value == null ? "" : value).trim().match(/\S+/g);
    return words ? words.length : 0;
  }

  // LCS de palavras, com limite para evitar cálculos quadráticos em textos extensos.
  // Conserva a pontuação e os espaços originais do texto corrigido.
  function diffCorrectedText(original, corrected) {
    if (typeof original !== "string" || typeof corrected !== "string") {
      throw new TypeError("Os dois textos precisam ser strings.");
    }
    const before = original.match(/\S+/g) || [];
    const after = corrected.match(/\S+/g) || [];
    const marked = new Set();
    if (before.length > 450 || after.length > 450) {
      after.forEach((word, index) => {
        if (word !== before[index]) marked.add(index);
      });
    } else {
      const matrix = Array.from({ length: before.length + 1 },
        () => new Uint16Array(after.length + 1));
      for (let i = before.length - 1; i >= 0; i--) {
        for (let j = after.length - 1; j >= 0; j--) {
          matrix[i][j] = before[i] === after[j]
            ? matrix[i + 1][j + 1] + 1
            : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
        }
      }
      const unchanged = new Set();
      let i = 0;
      let j = 0;
      while (i < before.length && j < after.length) {
        if (before[i] === after[j]) {
          unchanged.add(j);
          i++;
          j++;
        } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
          i++;
        } else {
          j++;
        }
      }
      for (let index = 0; index < after.length; index++) {
        if (!unchanged.has(index)) marked.add(index);
      }
    }

    let position = 0;
    return (corrected.match(/\s+|\S+/g) || []).map(function (token) {
      if (/^\s+$/.test(token)) {
        return { text: token, changed: false };
      }
      const changed = marked.has(position);
      position++;
      return { text: token, changed: changed };
    });
  }

  function appendCorrectedText(container, original, corrected) {
    const paragraph = element("p", "homework-pedagogical-body");
    for (const segment of diffCorrectedText(original, corrected)) {
      paragraph.appendChild(element(segment.changed ? "mark" : "span",
        segment.changed ? "homework-pedagogical-changed" : "", segment.text));
    }
    container.appendChild(paragraph);
  }


  function inspectForApproval(exercise, version, questions) {
    if (!exercise || !version || !Array.isArray(questions) ||
        !TYPE_LABELS[exercise.activity_type]) {
      throw new TypeError("Dados de revisão incompletos.");
    }
    const content = version.content || {};
    const type = exercise.activity_type;
    const main = type === "reading" ? content.passage :
      type === "writing" ? content.prompt : content.explanation;
    const issues = [];
    if (typeof main !== "string" || !main.trim()) {
      issues.push("Preencha o conteúdo principal da atividade.");
    }
    if (type === "reading" && questions.length !== 10) {
      issues.push("Reading exige exatamente 10 perguntas.");
    }
    if (type === "grammar" && questions.length < 1) {
      issues.push("Grammar exige ao menos uma questão.");
    }
    if (type === "writing" && questions.length !== 0) {
      issues.push("Writing não deve conter questões objetivas.");
    }
    if (type !== "writing") {
      questions.forEach(function (question, index) {
        const number = index + 1;
        if (typeof question.prompt !== "string" || !question.prompt.trim()) {
          issues.push("A questão " + number + " não contém enunciado.");
        }
        const accepted = acceptedAnswers(question);
        if (!accepted.length) {
          issues.push("A questão " + number + " não contém gabarito.");
        }
        if (question.question_type === "multiple_choice") {
          const options = Array.isArray(question.options) ? question.options : [];
          if (options.length < 2 ||
              accepted.some(answer => !options.includes(answer))) {
            issues.push("A questão " + number + " possui alternativas inconsistentes.");
          }
        }
      });
    }
    return Object.freeze({ ready: issues.length === 0, issues: Object.freeze(issues) });
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
    if (activityType === "writing" && typeof content.model === "string" &&
        content.model.trim()) {
      container.appendChild(element("h3", "", "Modelo de referência"));
      appendText(container, content.model, "homework-pedagogical-body");
    }
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
      const label = element("label", "homework-pedagogical-input-label",
        "Sua resposta");
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
    if (acceptedAnswers(question).length) {
      const answer = element("details", "homework-pedagogical-answer-key");
      answer.appendChild(element("summary", "", "Conferir gabarito (professor)"));
      appendText(answer, "Respostas aceitas: " + acceptedAnswers(question).join("; "));
      appendText(answer, question.explanation, "homework-pedagogical-explanation");
      wrapper.appendChild(answer);
    }
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
    const clear = element("button", "homework-pedagogical-reset", "Limpar respostas");
    clear.type = "reset";
    const progress = element("p", "homework-pedagogical-progress");
    progress.setAttribute("role", "status");
    progress.setAttribute("aria-live", "polite");
    const updateProgress = function () {
      const answered = fields.filter(field => String(field.read()).trim()).length;
      progress.textContent = "Questões respondidas: " + answered + " de " + questions.length;
    };
    form.addEventListener("input", updateProgress);
    form.addEventListener("change", updateProgress);
    form.addEventListener("reset", function () {
      fields.forEach(field => { field.message.textContent = ""; });
      summary.textContent = "";
      progress.textContent = "Questões respondidas: 0 de " + questions.length;
    });
    form.append(progress, submit, clear, summary);
    updateProgress();
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
          : questions[index].question_type === "multiple_choice"
            ? "Alternativa diferente do gabarito."
            : "Resposta diferente do gabarito: na correção automática, vale zero.";
      });
      summary.textContent = results.total
        ? "Simulação local: " + results.correct + " de " + results.total +
          " respostas coincidiram com o gabarito. Correspondência aproximada: " +
          (results.score * 10).toLocaleString("pt-BR") +
          "%. Não é nota oficial; na entrega oficial, respostas divergentes recebem zero automaticamente."
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
    const counter = element("p", "homework-pedagogical-counter", "Palavras: 0");
    text.addEventListener("input", function () {
      counter.textContent = "Palavras: " + countWords(text.value);
    });
    const message = element("p", "homework-pedagogical-summary");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    form.append(label, counter, button, message);
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
    appendText(panel, "Trechos alterados aparecem destacados.");
    appendCorrectedText(panel, feedback.original_text, feedback.corrected_text);
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
    countWords: countWords,
    diffCorrectedText: diffCorrectedText,
    inspectForApproval: inspectForApproval,
    render: render,
    appendWritingFeedback: appendWritingFeedback
  });
})(window);

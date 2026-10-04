(function () {
  "use strict";

  function normalizeExample(example) {
    return {
      answer: String(example && example.answer || "").trim(),
      translation: String(example && example.translation || "").trim(),
      note: String(example && example.note || "").trim()
    };
  }

  function normalizeQuestion(question) {
    return {
      id: question && question.id,
      text: String(question && (question.text || question.question_text) || "").trim(),
      translation: String(question && (question.translation || question.question_translation) || "").trim(),
      displayOrder: Number(question && (question.display_order || question.displayOrder)) || null,
      examples: Array.isArray(question && (question.examples || question.answer_examples))
        ? (question.examples || question.answer_examples).map(normalizeExample)
        : []
    };
  }

  function createQuestionTitle(question) {
    const title = document.createElement("div");
    title.className = "conversation-card-question";

    const english = document.createElement("span");
    english.className = "conversation-card-question-english";
    english.textContent = question.text;
    title.appendChild(english);

    if (question.translation) {
      const translation = document.createElement("span");
      translation.className = "conversation-card-question-translation";
      translation.textContent = " (" + question.translation + ")";
      title.appendChild(translation);
    }

    return title;
  }

  function createExample(example) {
    const item = document.createElement("li");
    item.className = "conversation-card-example";

    const answer = document.createElement("span");
    answer.className = "conversation-card-example-answer";
    answer.textContent = "“" + example.answer + "”";
    item.appendChild(answer);

    if (example.translation) {
      const translation = document.createElement("span");
      translation.className = "conversation-card-example-translation";
      translation.textContent = " (" + example.translation + ")";
      item.appendChild(translation);
    }

    if (example.note) {
      const separator = document.createElement("span");
      separator.className = "conversation-card-example-separator";
      separator.textContent = " - ";
      item.appendChild(separator);

      const note = document.createElement("span");
      note.className = "conversation-card-example-note";
      note.textContent = example.note;
      item.appendChild(note);
    }

    return item;
  }

  function create(questionInput, options) {
    const question = normalizeQuestion(questionInput);
    const config = options || {};
    const card = document.createElement(config.element || "article");
    card.className = ["conversation-card", config.className || ""].filter(Boolean).join(" ");

    const heading = document.createElement("div");
    heading.className = "conversation-card-heading";

    if (config.number !== undefined && config.number !== null) {
      const number = document.createElement("span");
      number.className = "conversation-card-number";
      number.textContent = String(config.number) + ".";
      heading.appendChild(number);
    }

    heading.appendChild(createQuestionTitle(question));
    card.appendChild(heading);

    const examplesTitle = document.createElement("p");
    examplesTitle.className = "conversation-card-examples-title";
    examplesTitle.textContent = "Exemplos de respostas:";
    card.appendChild(examplesTitle);

    const examples = document.createElement("ul");
    examples.className = "conversation-card-examples";
    question.examples.forEach(function (example) {
      examples.appendChild(createExample(example));
    });
    card.appendChild(examples);

    return card;
  }

  window.ConversationQuestionCardRenderer = Object.freeze({
    create: create,
    normalizeQuestion: normalizeQuestion
  });
})();
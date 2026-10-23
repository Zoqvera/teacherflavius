import { loadPublicSamples } from "./samples_service.mjs";

const REQUEST_TIMEOUT_MS = 12000;
const nodes = {
  presentationList: document.getElementById("methodologySampleLessons"),
  questionList: document.getElementById("methodologySampleQuestions"),
  activeQuestion: document.getElementById("methodologyActiveQuestion"),
  answerList: document.getElementById("methodologyAnswers"),
  revealAnswers: document.getElementById("methodologyRevealAnswers"),
  questionPosition: document.getElementById("methodologyQuestionPosition"),
  previousQuestion: document.getElementById("methodologyPreviousQuestion"),
  nextQuestion: document.getElementById("methodologyNextQuestion"),
  status: document.getElementById("methodologySamplesStatus"),
  retry: document.getElementById("methodologySamplesRetry")
};

const state = { questions: [], activeIndex: 0, showAnswers: false };

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeField(label, content, expandable = false) {
  if (!content) return null;

  if (expandable) {
    const details = element("details", "sample-field sample-field-collapsible");
    const summary = element("summary", "", label);
    details.append(summary, element("p", "sample-field-text", content));
    return details;
  }

  const container = element("div", "sample-field");
  container.append(
    element("h4", "sample-field-label", label),
    element("p", "sample-field-text", content)
  );
  return container;
}

function createPresentation(lesson) {
  const card = element("details", "sample-presentation");
  const summary = element("summary", "sample-presentation-summary");
  const heading = element("span", "sample-presentation-title");
  heading.append(
    element("span", "sample-presentation-kicker", "Apresentação " + lesson.number),
    element("span", "", lesson.title)
  );
  summary.append(heading, element("span", "sample-presentation-cta", "Explorar material"));

  const body = element("div", "sample-presentation-body");
  const fields = [
    makeField("Objetivo da apresentação", lesson.objective),
    makeField("Texto de exemplo em inglês", lesson.example),
    makeField("Ver tradução do texto", lesson.translation, true),
    makeField("Agora é a sua vez", lesson.practicalExercise),
    makeField("Consultar vocabulário de apoio", lesson.usefulVocabulary, true)
  ];
  fields.filter(Boolean).forEach(field => body.appendChild(field));
  card.append(summary, body);
  return card;
}

function renderPresentations(lessons) {
  const fragment = document.createDocumentFragment();
  lessons.forEach(lesson => fragment.appendChild(createPresentation(lesson)));
  nodes.presentationList.replaceChildren(fragment);
}

function renderQuestionTabs() {
  const fragment = document.createDocumentFragment();
  state.questions.forEach((item, index) => {
    const button = element("button", "sample-question-tab", item.question);
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === state.activeIndex));
    button.addEventListener("click", () => selectQuestion(index));
    fragment.appendChild(button);
  });
  nodes.questionList.replaceChildren(fragment);
}

function selectQuestion(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.questions.length) return;
  state.activeIndex = index;
  state.showAnswers = false;
  renderCurrentQuestion();
}

function renderAnswers(question) {
  const list = document.createDocumentFragment();
  question.examples.forEach((example, index) => {
    const item = element("li", "sample-answer");
    item.append(element("span", "sample-answer-number", "Resposta " + (index + 1)));
    item.append(element("p", "sample-answer-primary", example.answer));
    if (example.translation) item.append(element("p", "sample-answer-translation", example.translation));
    if (example.note) item.append(element("p", "sample-answer-note", example.note));
    list.appendChild(item);
  });
  nodes.answerList.replaceChildren(list);
}

function renderCurrentQuestion() {
  const question = state.questions[state.activeIndex];
  if (!question) return;

  const tabs = nodes.questionList.querySelectorAll("button");
  tabs.forEach((tab, index) => {
    tab.setAttribute("aria-pressed", String(index === state.activeIndex));
  });

  nodes.questionPosition.textContent = "Pergunta " + (state.activeIndex + 1) + " de " + state.questions.length;
  nodes.activeQuestion.replaceChildren(
    element("h3", "sample-active-question-title", question.question),
    element("p", "sample-active-question-translation", question.translation)
  );

  nodes.revealAnswers.textContent = state.showAnswers
    ? "Ocultar exemplos de resposta"
    : "Mostrar exemplos de resposta";
  nodes.revealAnswers.setAttribute("aria-expanded", String(state.showAnswers));
  nodes.answerList.hidden = !state.showAnswers;
  nodes.answerList.replaceChildren();

  if (state.showAnswers) renderAnswers(question);

  nodes.previousQuestion.disabled = state.activeIndex === 0;
  nodes.nextQuestion.disabled = state.activeIndex === state.questions.length - 1;
}

function renderQuestions(questions) {
  state.questions = questions;
  state.activeIndex = 0;
  state.showAnswers = false;
  nodes.revealAnswers.hidden = false;
  renderQuestionTabs();
  renderCurrentQuestion();
}

async function loadSamples() {
  nodes.retry.hidden = true;
  nodes.status.textContent = "Carregando demonstrações selecionadas...";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const samples = await loadPublicSamples(window.fetch.bind(window), { signal: controller.signal });
    renderPresentations(samples.lessons);
    renderQuestions(samples.questions);
    nodes.status.textContent = "";
  } catch {
    nodes.status.textContent = "Não foi possível carregar as demonstrações. Tente novamente.";
    nodes.retry.hidden = false;
  } finally {
    window.clearTimeout(timeout);
  }
}

nodes.revealAnswers.addEventListener("click", () => {
  state.showAnswers = !state.showAnswers;
  renderCurrentQuestion();
});

nodes.previousQuestion.addEventListener("click", () => selectQuestion(state.activeIndex - 1));
nodes.nextQuestion.addEventListener("click", () => selectQuestion(state.activeIndex + 1));
nodes.retry.addEventListener("click", () => void loadSamples());

void loadSamples();

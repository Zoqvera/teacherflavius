"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("pedagogical_translation_ui.js", "utf8");

function element() {
  return { value: "", textContent: "", hidden: true, disabled: false, children: [], listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; },
    appendChild(node) { this.children.push(node); },
    replaceChildren() { this.children = []; },
    fire(event) { return this.listeners[event](); } };
}
function fixture(invoke) {
  const ids = ["translationSource", "translationLevel", "translationButton", "translationStatus", "translationResult", "translationText", "translationExpressions", "translationComparisons", "translationPractice", "translationCopy"];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const window = {};
  const document = { getElementById(id) { return elements[id]; }, createElement() { return element(); } };
  const copied = [];
  vm.runInNewContext(source, { window, document, navigator: { clipboard: { async writeText(value) { copied.push(value); } } } });
  window.PedagogicalTranslation.mount({ lessonNumber: 1, getClient: () => ({ functions: { invoke } }) });
  return { elements, copied };
}
const result = { translation: "I study English.", expressions: [{ english: "study", portuguese: "estudar" }], comparisons: [{ portuguese: "Eu estudo", english: "I study", explanation: "Use I." }], practice: [{ prompt: "O que você estuda?", example: "I study English." }] };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("traduz e oferece prática e cópia sem alterar apresentação", async () => {
  let sent;
  const { elements: e, copied } = fixture(async (_name, options) => { sent = options.body; return { data: result }; });
  e.translationSource.value = "Eu estudo inglês.";
  e.translationLevel.value = "A1";
  e.translationButton.fire("click");
  await flush();
  assert.equal(sent.text, "Eu estudo inglês.");
  assert.equal(e.translationText.textContent, result.translation);
  assert.equal(e.translationResult.hidden, false);
  assert.equal(e.translationPractice.children.length, 1);
  await e.translationCopy.fire("click");
  assert.deepEqual(copied, [result.translation]);
  e.translationSource.fire("input");
  assert.equal(e.translationResult.hidden, true);
});

test("descarta resposta antiga quando o texto muda durante a chamada", async () => {
  let finish;
  const { elements: e } = fixture(() => new Promise(resolve => { finish = resolve; }));
  e.translationSource.value = "Olá";
  e.translationButton.fire("click");
  e.translationSource.fire("input");
  finish({ data: result });
  await flush();
  assert.equal(e.translationResult.hidden, true);
  assert.equal(e.translationButton.disabled, false);
});

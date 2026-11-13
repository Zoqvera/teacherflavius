(function () {
  "use strict";

  function mount(context) {
    const get = function (id) { return document.getElementById(id); };
    const source = get("translationSource");
    const level = get("translationLevel");
    const button = get("translationButton");
    const status = get("translationStatus");
    const result = get("translationResult");
    const translation = get("translationText");
    const expressions = get("translationExpressions");
    const comparisons = get("translationComparisons");
    const practice = get("translationPractice");
    const copy = get("translationCopy");
    if (!source || !level || !button || !status || !result || !translation || !expressions || !comparisons || !practice || !copy) return;
    let requestVersion = 0;
    let busy = false;

    function add(parent, tag, value) {
      const node = document.createElement(tag);
      node.textContent = value;
      parent.appendChild(node);
      return node;
    }

    function clearResult() {
      requestVersion += 1;
      result.hidden = true;
      status.textContent = "";
    }

    function show(data) {
      translation.textContent = data.translation;
      expressions.replaceChildren();
      comparisons.replaceChildren();
      practice.replaceChildren();
      data.expressions.forEach(function (item) { add(expressions, "li", item.english + " — " + item.portuguese); });
      data.comparisons.forEach(function (item) {
        const block = add(comparisons, "div", "");
        add(block, "p", "Português: " + item.portuguese);
        add(block, "p", "Inglês: " + item.english);
        add(block, "p", item.explanation);
      });
      data.practice.forEach(function (item, index) {
        const block = add(practice, "div", "");
        const label = add(block, "label", item.prompt);
        const field = document.createElement("textarea");
        field.id = "translationPracticeAnswer" + index;
        field.rows = 2;
        label.htmlFor = field.id;
        block.appendChild(field);
        const answer = document.createElement("details");
        add(answer, "summary", "Ver uma resposta possível");
        add(answer, "p", item.example);
        block.appendChild(answer);
      });
      result.hidden = false;
    }

    async function translate() {
      const text = source.value.trim();
      if (busy) return;
      if (!text) { status.textContent = "Escreva seu texto em português."; return; }
      const version = ++requestVersion;
      result.hidden = true;
      busy = true;
      button.disabled = true;
      status.textContent = "Preparando sua tradução e atividades...";
      try {
        const response = await context.getClient().functions.invoke("pedagogical-translation", {
          body: { text: text, level: level.value, lessonNumber: context.lessonNumber || null, pageId: context.pageId || null }
        });
        if (version !== requestVersion) return;
        if (response.error || !response.data || response.data.error) throw new Error("Não foi possível gerar a tradução. Tente novamente mais tarde.");
        show(response.data);
        status.textContent = "Tradução pronta. Leia as explicações e pratique antes de copiar.";
      } catch (_) {
        if (version === requestVersion) status.textContent = "Não foi possível gerar a tradução. Tente novamente mais tarde.";
      } finally {
        busy = false;
        button.disabled = false;
      }
    }

    source.addEventListener("input", clearResult);
    level.addEventListener("change", clearResult);
    button.addEventListener("click", function () { void translate(); });
    copy.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(translation.textContent);
        status.textContent = "Tradução copiada. Cole no campo da apresentação.";
      } catch (_) {
        status.textContent = "Não foi possível copiar automaticamente. Selecione e copie a tradução.";
      }
    });
  }

  window.PedagogicalTranslation = Object.freeze({ mount: mount });
})();

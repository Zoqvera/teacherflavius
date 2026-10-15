(function (root) {
  "use strict";

  const TYPES = Object.freeze({
    reading: "Reading",
    writing: "Writing",
    grammar: "Grammar"
  });
  const MAX_WRITING_LENGTH = 3000;

  function createElement(tag, className, label) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (label != null) node.textContent = String(label);
    return node;
  }

  function appendText(parent, tag, text, className) {
    if (typeof text === "string" && text.trim()) {
      parent.appendChild(createElement(tag, className, text));
    }
  }

  function appendParagraphs(parent, values) {
    if (!Array.isArray(values)) return;
    const list = createElement("ul", "homework-student-guidance");
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        list.appendChild(createElement("li", "", value));
      }
    }
    if (list.childElementCount) parent.appendChild(list);
  }

  function safeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) &&
      value >= 0 && value <= 10 ? value.toLocaleString("pt-BR") : null;
  }

  function buildAnswers(type, fields, writing) {
    if (type === "writing") {
      const text = writing.value.trim();
      if (text.length < 20 || text.length > MAX_WRITING_LENGTH) {
        throw new Error("Seu texto deve conter entre 20 e 3.000 caracteres.");
      }
      return { text: text };
    }
    return fields.map(function (field) {
      const response = field.read().trim();
      if (!response) throw new Error("Responda a todas as perguntas antes de enviar.");
      return { question_id: field.id, response: response };
    });
  }

  function create(config) {
    const { mount, notice, auth, service, feedbackRenderer } = config || {};
    if (!mount || !notice || !service || !auth || !feedbackRenderer ||
      typeof feedbackRenderer.appendWritingFeedback !== "function") {
      throw new TypeError("Dependências da interface estudantil incompletas.");
    }
    let activeAssignment = null;
    let currentDetail = null;
    let currentSubmission = null;
    let busy = false;

    function status(message) {
      notice.textContent = message;
    }

    async function withLock(work) {
      if (busy) return;
      busy = true;
      try {
        await work();
      } catch (error) {
        status("Não foi possível concluir: " + (error?.message || "erro inesperado"));
      } finally {
        busy = false;
      }
    }

    function button(label, callback) {
      const control = createElement("button", "homework-student-button", label);
      control.type = "button";
      control.addEventListener("click", function () {
        void withLock(callback);
      });
      return control;
    }

    function heading(text) {
      const title = createElement("h2", "homework-student-heading", text);
      title.tabIndex = -1;
      return title;
    }

    function replaceView(fragment, title) {
      mount.replaceChildren(fragment);
      // Keep keyboard and assistive-technology focus on the newly opened view.
      title.focus();
    }

    function renderFeedback(progress, type) {
      const panel = createElement("section", "homework-student-result");
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      const score = safeNumber(progress.score);
      const resultStatus = progress.status;
      if (resultStatus === "evaluating") {
        appendText(panel, "p", "Sua resposta foi salva. A correção está sendo processada.");
      } else if (resultStatus === "submitted") {
        const pausedForBudget = type === "writing" &&
          progress.correction === "monthly_budget";
        appendText(panel, "p", pausedForBudget
          ? "Seu texto foi salvo. O limite mensal de correções por IA foi atingido. " +
            "A correção poderá ser retomada no mês seguinte."
          : type === "writing"
            ? "Seu texto está salvo. A correção está pendente; consulte o progresso mais tarde."
            : "Suas respostas foram salvas. A nota automática está sendo confirmada.");
      } else if (resultStatus === "evaluated") {
        appendText(panel, "h3", "Atividade corrigida");
        if (score !== null) appendText(panel, "p", "Nota: " + score + "/10");
      } else {
        return panel;
      }

      if (type === "writing" && resultStatus === "submitted" &&
          progress.correction !== "monthly_budget") {
        panel.appendChild(button("Tentar corrigir novamente", async function () {
          status("Retomando a correção do texto já enviado...");
          const resumed = await service.retryCorrection(auth, activeAssignment);
          showProgress(resumed);
        }));
      }
      const feedback = Array.isArray(progress.feedback) ? progress.feedback : [];
      const aiFeedback = feedback.find(item => item && item.source === "ai");
      if (type === "writing" && aiFeedback) {
        const container = createElement("div", "homework-student-writing-feedback");
        feedbackRenderer.appendWritingFeedback(container, aiFeedback);
        panel.appendChild(container);
      } else {
        for (const item of feedback) {
          if (item && typeof item.general_comment === "string") {
            appendText(panel, "p", item.general_comment);
          }
        }
      }
      panel.appendChild(button("Atualizar progresso", async function () {
        const latest = await service.progress(auth, activeAssignment);
        showProgress(latest);
      }));
      return panel;
    }

    function showProgress(progress) {
      if (progress?.status === "not_started") {
        renderActivity(currentDetail);
        return;
      }
      const fragment = document.createDocumentFragment();
      const title = heading("ATIVIDADE " + currentDetail.exercise_number +
        " — " + TYPES[currentDetail.activity_type]);
      fragment.appendChild(title);
      fragment.appendChild(renderFeedback(progress, currentDetail.activity_type));
      fragment.appendChild(button("Voltar às atividades", load));
      replaceView(fragment, title);
      status("Progresso consultado com segurança.");
    }

    function appendContent(container, detail) {
      const content = detail.content || {};
      if (detail.activity_type === "reading") {
        appendText(container, "h3", "Texto de leitura");
        appendText(container, "p", content.passage, "homework-student-passage");
        appendParagraphs(container, content.instructions);
      } else if (detail.activity_type === "writing") {
        appendText(container, "h3", "Produção escrita");
        appendText(container, "p", content.prompt);
        appendParagraphs(container, content.guidelines);
        if (content.model) {
          appendText(container, "h4", "Modelo de referência");
          appendText(container, "p", content.model);
        }
      } else {
        appendText(container, "h3", "Explicação");
        appendText(container, "p", content.explanation);
        appendParagraphs(container, content.examples);
        appendParagraphs(container, content.instructions);
      }
    }

    function appendQuestions(form, detail, fields) {
      for (const [index, question] of detail.questions.entries()) {
        const fieldset = createElement("fieldset", "homework-student-question");
        const legend = createElement("legend", "", (index + 1) + ". " + question.prompt);
        fieldset.appendChild(legend);
        if (question.question_type === "multiple_choice") {
          const options = Array.isArray(question.options) ? question.options : [];
          if (options.length < 2) throw new Error("Alternativas incompletas.");
          const select = createElement("select", "homework-student-input");
          select.required = true;
          const placeholder = createElement("option", "", "Selecione uma alternativa");
          placeholder.value = "";
          select.appendChild(placeholder);
          for (const option of options) {
            const choice = createElement("option", "", option);
            choice.value = String(option);
            select.appendChild(choice);
          }
          select.setAttribute("aria-label", "Questão " + (index + 1));
          fieldset.appendChild(select);
          fields.push({ id: question.id, read: () => select.value });
        } else if (question.question_type === "short_answer") {
          const input = createElement("input", "homework-student-input");
          input.type = "text";
          input.maxLength = 2000;
          input.required = true;
          input.setAttribute("aria-label", "Resposta da questão " + (index + 1));
          fieldset.appendChild(input);
          fields.push({ id: question.id, read: () => input.value });
        } else {
          throw new Error("Formato de questão não reconhecido.");
        }
        form.appendChild(fieldset);
      }
    }

    function renderActivity(detail) {
      const fragment = document.createDocumentFragment();
      const title = heading("ATIVIDADE " + detail.exercise_number +
        " — " + TYPES[detail.activity_type]);
      fragment.appendChild(title);
      appendText(fragment, "h3", detail.title);
      appendContent(fragment, detail);
      const form = createElement("form", "homework-student-form");
      const fields = [];
      let writing = null;
      if (detail.activity_type === "writing") {
        const label = createElement("label", "", "Sua produção escrita em inglês");
        writing = createElement("textarea", "homework-student-input");
        writing.rows = 10;
        writing.minLength = 20;
        writing.maxLength = MAX_WRITING_LENGTH;
        writing.required = true;
        label.appendChild(writing);
        form.appendChild(label);
        appendText(form, "p",
          "Para receber a correção automática, seu texto será enviado ao serviço de IA da OpenAI. " +
          "Não inclua nomes completos, telefones, endereços ou outros dados pessoais.");
        const counter = createElement("p", "", "Caracteres: 0 / " + MAX_WRITING_LENGTH);
        counter.setAttribute("aria-live", "polite");
        writing.addEventListener("input", function () {
          counter.textContent = "Caracteres: " + writing.value.length +
            " / " + MAX_WRITING_LENGTH;
        });
        form.appendChild(counter);
      } else {
        appendQuestions(form, detail, fields);
      }
      const action = createElement("button", "homework-student-button", "Enviar");
      action.type = "submit";
      form.appendChild(action);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        void withLock(async function () {
          if (!currentSubmission) {
            const answers = buildAnswers(detail.activity_type, fields, writing);
            currentSubmission = service.makeSubmission(activeAssignment, answers);
          }
          action.disabled = true;
          status("Enviando atividade e consultando a correção...");
          try {
            const response = await service.submit(auth, currentSubmission);
            let confirmed = response;
            try {
              const progress = await service.progress(auth, activeAssignment);
              // Caso o progresso esteja momentaneamente desatualizado,
              // priorize o resultado final devolvido pelo próprio envio.
              if (progress?.status === "evaluated" || response?.status !== "evaluated") {
                confirmed = progress?.status === "not_started" ? response : progress || response;
              }
            } catch {
              // Se a submissão foi confirmada, uma falha na consulta de progresso
              // não deve ocultar a nota ou induzir um segundo envio.
            }
            // O status de progresso não inclui a razão administrativa da pausa.
            // Preserve a resposta explícita da Edge quando o orçamento se esgota.
            if (response?.correction === "monthly_budget") confirmed = response;
            showProgress(confirmed);
          } catch (error) {
            // Conserva a mesma chave e as mesmas respostas após falhas de rede.
            // Uma nova chave poderia duplicar ou invalidar a entrega já persistida.
            status("Envio não confirmado. Tente novamente sem editar suas respostas.");
            throw error;
          } finally {
            action.disabled = false;
          }
        });
      });
      fragment.appendChild(form);
      fragment.appendChild(button("Voltar às atividades", load));
      replaceView(fragment, title);
      status("Atividade carregada. Responda antes de enviar.");
    }

    async function openActivity(assignmentId) {
      if (!assignmentId || typeof assignmentId !== "string") {
        throw new TypeError("Atividade não identificada.");
      }
      activeAssignment = assignmentId;
      currentSubmission = null;
      const detail = await service.detail(auth, assignmentId);
      if (!detail || !Object.hasOwn(TYPES, detail.activity_type) ||
        !Array.isArray(detail.questions)) {
        throw new Error("Conteúdo da atividade inválido.");
      }
      currentDetail = detail;
      const progress = await service.progress(auth, assignmentId);
      showProgress(progress);
    }

    function open(assignmentId) {
      return withLock(() => openActivity(assignmentId));
    }

    async function load() {
      const result = await service.list(auth);
      const rows = Array.isArray(result?.assignments) ? result.assignments : [];
      const fragment = document.createDocumentFragment();
      const title = heading("Minhas tarefas para casa");
      fragment.appendChild(title);
      if (rows.length === 0) appendText(fragment, "p", "Ainda não há atividades disponíveis.");
      const list = createElement("ol", "homework-student-list");
      for (const row of rows) {
        if (!Object.hasOwn(TYPES, row.activity_type)) continue;
        const item = createElement("li", "homework-student-item");
        appendText(item, "strong", "ATIVIDADE " + row.exercise_number +
          " — " + TYPES[row.activity_type]);
        appendText(item, "span", row.title);
        const score = safeNumber(row.score);
        appendText(item, "span", score === null ? (row.status === "not_started"
          ? "Não realizada" : "Correção em processamento") : "Nota: " + score + "/10");
        item.appendChild(button("Abrir atividade", () => openActivity(row.assignment_id)));
        list.appendChild(item);
      }
      fragment.appendChild(list);
      replaceView(fragment, title);
      status("Lista de atividades atualizada.");
    }

    return Object.freeze({
      load: () => withLock(load),
      open: open
    });
  }

  root.HomeworkStudentInterface = Object.freeze({
    create: create,
    buildAnswers: buildAnswers
  });
})(window);

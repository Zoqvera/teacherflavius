(function () {
  "use strict";

  const HOMEWORK_PATH = "/area-do-estudante/homeworks/";
  const LOGIN_PATH = "/login/";
  const AUTH_MAX_ATTEMPTS = 40;
  const AUTH_RETRY_DELAY_MS = 100;
  const TYPE_LABELS = Object.freeze({
    reading: "Reading",
    writing: "Writing",
    grammar: "Grammar"
  });

  let currentExercise = null;
  let busy = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function showStatus(message) {
    const status = byId("homeworkStatus");
    if (status) status.textContent = message;
  }

  function authIsReady() {
    return !!(window.Auth && window.SUPABASE_CONFIG && window.HomeworkAccessService &&
      window.HomeworkAdminService && window.HomeworkPedagogicalPreview &&
      window.Auth.isConfigured());
  }

  function lines(text) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function toQuestions(text) {
    return lines(text).map(function (line) {
      const parts = line.split(/\s+\|\s+/).map(part => part.trim());
      if (!parts[0]) {
        throw new TypeError("Toda questão deve conter um enunciado.");
      }
      if (parts.length === 3) {
        const options = parts[1].split(";").map(option => option.trim()).filter(Boolean);
        if (options.length < 2 || new Set(options).size !== options.length ||
            !options.includes(parts[2])) {
          throw new TypeError("Questão de alternativas inválida: " + parts[0]);
        }
        return {
          type: "multiple_choice",
          prompt: parts[0],
          options: options,
          answer_key: { accepted: [parts[2]] }
        };
      }
      if (parts.length > 3) {
        throw new TypeError("Separe cada questão usando ' | ' apenas.");
      }
      return {
        type: "short_answer",
        prompt: parts[0],
        options: [],
        answer_key: parts[1] ? { accepted: [parts[1]] } : null
      };
    });
  }

  function serializeEditor(exercise) {
    const main = byId("homeworkMainText").value.trim();
    const guidance = lines(byId("homeworkGuidance").value);
    const examples = lines(byId("homeworkExamples").value);
    const content = exercise.activity_type === "reading"
      ? { passage: main, instructions: guidance }
      : exercise.activity_type === "writing"
        ? { prompt: main, guidelines: guidance, model: examples.join("\n") }
        : { explanation: main, instructions: guidance, examples: examples };
    return {
      exerciseId: exercise.id,
      title: byId("homeworkTitle").value.trim(),
      content: content,
      questions: exercise.activity_type === "writing" ? [] : toQuestions(byId("homeworkQuestions").value)
    };
  }

  function populateEditor(exercise, version, questions) {
    const content = version ? version.content || {} : {};
    byId("homeworkEditorTitle").textContent = "ATIVIDADE " + exercise.exercise_number +
      " — " + TYPE_LABELS[exercise.activity_type];
    byId("homeworkTitle").value = exercise.title;
    byId("homeworkMainText").value = content.passage || content.prompt || content.explanation || "";
    byId("homeworkGuidance").value = (content.instructions || content.guidelines || []).join("\n");
    byId("homeworkExamples").value = Array.isArray(content.examples)
      ? content.examples.join("\n") : (content.model || "");
    byId("homeworkQuestions").value = questions.map(function (question) {
      const accepted = question.answer_key && question.answer_key.accepted;
      return question.prompt +
        (question.question_type === "multiple_choice" && Array.isArray(question.options)
          ? " | " + question.options.join("; ") : "") +
        (accepted && accepted[0] ? " | " + accepted[0] : "");
    }).join("\n");
    byId("homeworkMainLabel").textContent = {
      reading: "Texto de leitura em inglês",
      writing: "Enunciado de produção escrita",
      grammar: "Explicação gramatical"
    }[exercise.activity_type];
    byId("homeworkGuidanceLabel").textContent =
      exercise.activity_type === "writing" ? "Orientações (uma por linha)" :
        "Instruções (uma por linha)";
    byId("homeworkExamplesLabel").textContent =
      exercise.activity_type === "writing" ? "Modelo de texto (linhas separadas)" :
        "Exemplos (um por linha)";
    byId("homeworkQuestionGroup").hidden = exercise.activity_type === "writing";
    byId("homeworkQuestionHelp").textContent = exercise.activity_type === "reading"
      ? "Exatamente 10 perguntas em português. Formato: Pergunta | resposta esperada"
      : "Ao menos uma questão. Use Pergunta | resposta; ou Pergunta | opção A; opção B | resposta correta.";
    byId("homeworkVersionLabel").textContent = version
      ? "Última versão: " + version.version_number + " (" +
        (version.status === "approved" ? "aprovada" : "rascunho") + "). Salvar cria nova versão."
      : "Ainda não existem versões. O primeiro salvamento criará a versão 1.";
    byId("homeworkEditor").hidden = false;
  }

  async function openEditor(exercise) {
    currentExercise = exercise;
    const versions = await window.HomeworkAdminService.listVersions(window.Auth, exercise.id);
    const latest = versions[0] || null;
    const questions = latest
      ? await window.HomeworkAdminService.listQuestions(window.Auth, latest.id) : [];
    populateEditor(exercise, latest, questions);
    renderVersionHistory(exercise, versions);
    byId("homeworkTitle").focus();
  }

  async function openPedagogicalPreview(exercise, version) {
    const questions = await window.HomeworkAdminService.listQuestions(window.Auth, version.id);
    window.HomeworkPedagogicalPreview.render({
      mount: byId("homeworkPedagogicalPreviewContent"),
      exercise: exercise,
      version: version,
      questions: questions
    });
    byId("homeworkPedagogicalPreview").hidden = false;
    byId("homeworkPedagogicalPreviewTitle").focus();
  }

  function renderVersionHistory(exercise, versions) {
    const list = byId("homeworkVersionList");
    const fragment = document.createDocumentFragment();
    for (const version of versions) {
      const item = document.createElement("li");
      const information = document.createElement("span");
      information.textContent = "Versão " + version.version_number + " · " +
        (version.status === "approved" ? "Aprovada" : "Rascunho");
      const preview = createButton("Pré-visualizar versão " + version.version_number,
        async function () {
          await openPedagogicalPreview(exercise, version);
          showStatus("Pré-visualização da versão " + version.version_number +
            " aberta somente para o professor.");
        });
      item.append(information, preview);
      fragment.appendChild(item);
    }
    list.replaceChildren(fragment);
    byId("homeworkVersionHistory").hidden = versions.length === 0;
  }

  function createButton(label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = busy;
    button.addEventListener("click", function () {
      runAction(callback);
    });
    return button;
  }

  async function runAction(operation) {
    if (busy) return;
    busy = true;
    try {
      await operation();
    } catch (error) {
      showStatus("Operação não concluída: " + (error && error.message || "erro desconhecido"));
    } finally {
      busy = false;
    }
  }

  async function refreshCatalog() {
    const list = byId("homeworkActivityList");
    const exercises = await window.HomeworkAdminService.listExercises(window.Auth);
    const fragment = document.createDocumentFragment();

    for (const exercise of exercises) {
      const versions = await window.HomeworkAdminService.listVersions(window.Auth, exercise.id);
      const latest = versions[0];
      const item = document.createElement("li");
      item.className = "homework-activity";
      const information = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = "ATIVIDADE " + exercise.exercise_number +
        " — " + TYPE_LABELS[exercise.activity_type];
      const details = document.createElement("span");
      details.textContent = exercise.title + " · " +
        (exercise.status === "published" ? "Publicada internamente (sem acesso de alunos)" :
          "Rascunho") + (latest ? " · versão " + latest.version_number : " · sem versão");
      information.append(heading, details);
      const controls = document.createElement("div");
      controls.className = "homework-controls";
      if (exercise.status === "draft") {
        controls.appendChild(createButton("Editar", async function () {
          await openEditor(exercise);
          showStatus("Editor aberto. As alterações ainda não foram salvas.");
        }));
        if (latest && latest.status === "draft") {
          controls.appendChild(createButton("Aprovar versão", async function () {
            const questions = await window.HomeworkAdminService.listQuestions(
              window.Auth, latest.id);
            const review = window.HomeworkPedagogicalPreview.inspectForApproval(
              exercise, latest, questions);
            if (!review.ready) {
              throw new Error("Revisão pedagógica: " + review.issues.join(" "));
            }
            await window.HomeworkAdminService.approveVersion(window.Auth, latest.id);
            await refreshCatalog();
            showStatus("Versão aprovada. A atividade permanece indisponível aos alunos.");
          }));
        }
        if (latest && latest.status === "approved") {
          controls.appendChild(createButton("Publicar internamente", async function () {
            await window.HomeworkAdminService.publishVersion(window.Auth, latest.id);
            byId("homeworkEditor").hidden = true;
            currentExercise = null;
            await refreshCatalog();
            showStatus("Atividade publicada apenas para o professor. Alunos continuam bloqueados.");
          }));
        }
      }
      if (latest) {
        controls.appendChild(createButton("Pré-visualizar", async function () {
          await openPedagogicalPreview(exercise, latest);
          showStatus("Pré-visualização pedagógica aberta somente para o professor.");
        }));
      }
      item.append(information, controls);
      fragment.appendChild(item);
    }
    if (exercises.length === 0) {
      const item = document.createElement("li");
      item.className = "homework-activity";
      item.textContent = "Nenhuma atividade cadastrada. Crie o primeiro rascunho para iniciar a sequência.";
      fragment.appendChild(item);
    }
    list.replaceChildren(fragment);
  }

  function bindControls() {
    byId("homeworkCreateDraft").addEventListener("click", function () {
      runAction(async function () {
        const created = await window.HomeworkAdminService.createDraft(window.Auth);
        await refreshCatalog();
        await openEditor(created);
        showStatus("Rascunho numerado criado. Nada foi disponibilizado aos alunos.");
      });
    });

    byId("homeworkEditorForm").addEventListener("submit", function (event) {
      event.preventDefault();
      runAction(async function () {
        if (!currentExercise) return;
        const draft = serializeEditor(currentExercise);
        await window.HomeworkAdminService.saveVersion(window.Auth, draft);
        const selected = currentExercise;
        await refreshCatalog();
        await openEditor({ ...selected, title: draft.title });
        showStatus("Nova versão salva como rascunho. Aprovação do professor pendente.");
      });
    });

    byId("homeworkCloseEditor").addEventListener("click", function () {
      byId("homeworkEditor").hidden = true;
      byId("homeworkVersionHistory").hidden = true;
      currentExercise = null;
    });

    byId("homeworkClosePedagogicalPreview").addEventListener("click", function () {
      byId("homeworkPedagogicalPreview").hidden = true;
      byId("homeworkPedagogicalPreviewContent").replaceChildren();
    });
  }

  function showTeacherPreview() {
    byId("homeworkPreview").hidden = false;
    bindControls();
    showStatus("Acesso do professor confirmado. Carregando catálogo privado...");
    refreshCatalog().then(function () {
      showStatus("Catálogo privado carregado. O acesso dos alunos permanece desativado.");
    }).catch(function (error) {
      showStatus("Falha ao carregar atividades: " + error.message);
    });
  }

  async function initialize() {
    if (!window.ResourceWaiter) {
      showStatus("Não foi possível iniciar a verificação de acesso.");
      return;
    }
    const ready = await window.ResourceWaiter.waitUntil(authIsReady, {
      maxAttempts: AUTH_MAX_ATTEMPTS,
      delayMs: AUTH_RETRY_DELAY_MS
    });
    if (!ready) {
      showStatus("A autenticação está indisponível. Atualize a página.");
      return;
    }
    const access = await window.HomeworkAccessService.resolveAccess(window.Auth);
    if (access === window.HomeworkAccessService.ACCESS.UNAUTHENTICATED) {
      window.location.replace(LOGIN_PATH + "?next=" + encodeURIComponent(HOMEWORK_PATH));
      return;
    }
    if (access !== window.HomeworkAccessService.ACCESS.TEACHER) {
      showStatus(access === window.HomeworkAccessService.ACCESS.FORBIDDEN
        ? "Acesso restrito ao professor. O recurso não está disponível para alunos."
        : "Não foi possível validar a permissão administrativa. Acesso bloqueado.");
      return;
    }
    showTeacherPreview();
  }

  initialize().catch(function (error) {
    console.error("Falha na inicialização de TAREFAS PARA CASA:", error);
    showStatus("Não foi possível abrir o gerenciamento. Acesso bloqueado.");
  });
})();

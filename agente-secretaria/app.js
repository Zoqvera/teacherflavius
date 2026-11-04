(function () {
  "use strict";

  const selectors = Object.freeze({
    status: "pageStatus",
    workspace: "workspace",
    searchForm: "searchForm",
    searchButton: "searchButton",
    search: "studentSearch",
    students: "studentResults",
    studentSummary: "studentSummary",
    planForm: "planForm",
    action: "action",
    classFields: "classFields",
    classNumber: "classNumber",
    transferFields: "transferFields",
    fromClassNumber: "fromClassNumber",
    newLinkFields: "newLinkFields",
    source: "source",
    sourceDetailField: "sourceDetailField",
    sourceDetail: "sourceDetail",
    firstLessonDate: "firstLessonDate",
    preview: "previewButton",
    result: "planResult",
    resultStatus: "resultStatus",
    issues: "resultIssues",
    steps: "resultSteps",
    archiveConfirmation: "archiveConfirmation",
    archiveConsent: "archiveConsent",
    archiveExecute: "archiveExecute",
    archiveDetails: "archiveDetails",
    archiveStatus: "archiveStatus"
  });

  function elements() {
    return Object.fromEntries(Object.entries(selectors).map(function ([key, id]) {
      return [key, document.getElementById(id)];
    }));
  }

  function setStatus(ui, message, isError) {
    ui.status.textContent = message;
    ui.status.classList.toggle("error", Boolean(isError));
  }

  function option(label, value) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    return item;
  }

  function replaceOptions(target, placeholder, items) {
    target.replaceChildren(option(placeholder, ""), ...items);
    target.value = "";
  }

  function clearArchiveReview(ui) {
    ui.archiveConfirmation.hidden = true;
    ui.archiveConsent.checked = false;
    ui.archiveExecute.disabled = true;
    ui.archiveStatus.textContent = "";
  }

  function showFields(ui) {
    clearArchiveReview(ui);
    const action = ui.action.value;
    const isLink = action === "new_link";
    const isTransfer = action === "transfer";
    ui.classFields.hidden = !(isLink || isTransfer);
    ui.transferFields.hidden = !isTransfer;
    ui.newLinkFields.hidden = !isLink;
    ui.sourceDetailField.hidden = !isLink || ui.source.value !== "other";
    ui.sourceDetail.required = isLink && ui.source.value === "other";
    ui.firstLessonDate.required = isLink;
    ui.source.required = isLink;
    ui.classNumber.required = isLink || isTransfer;
    ui.fromClassNumber.required = isTransfer;
    ui.result.hidden = true;
  }

  function renderPlan(ui, plan) {
    const labels = {
      blocked: "Operação bloqueada por uma regra de segurança.",
      needs_input: "Faltam informações antes da operação.",
      ready_for_review: "Plano pronto para revisão. Nenhuma operação foi executada."
    };
    const required = {
      source: "Informe a origem do novo aluno.",
      sourceDetail: "Descreva a outra origem.",
      firstLessonDate: "Informe a data da primeira aula.",
      fromClassNumber: "Informe a turma de origem."
    };
    const problems = plan.blockers.concat(plan.missingFields.map(function (name) {
      return required[name] || "Informação obrigatória: " + name;
    }));
    ui.resultStatus.textContent = labels[plan.status] || "Situação desconhecida.";
    ui.issues.replaceChildren(...problems.map(function (item) {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
    if (!problems.length) {
      const li = document.createElement("li");
      li.textContent = "Nenhuma pendência identificada nesta prévia.";
      ui.issues.appendChild(li);
    }
    ui.steps.replaceChildren(...plan.steps.map(function (step) {
      const li = document.createElement("li");
      li.textContent = step;
      return li;
    }));
    ui.result.hidden = false;
  }

  function formRequest(ui) {
    const request = {
      action: ui.action.value,
      studentId: ui.students.value
    };
    if (ui.classFields.hidden === false) {
      request.classNumber = Number(ui.classNumber.value);
    }
    if (request.action === "transfer") {
      request.fromClassNumber = Number(ui.fromClassNumber.value);
    }
    if (request.action === "new_link") {
      request.source = ui.source.value;
      request.firstLessonDate = ui.firstLessonDate.value;
      if (request.source === "other") request.sourceDetail = ui.sourceDetail.value.trim();
    }
    return request;
  }

  function normalizeQuery(value) {
    const term = String(value || "").trim().slice(0, 80);
    if (term.length < 2) throw new Error("Informe pelo menos dois caracteres do nome.");
    // Escape wildcards to avoid treating names as arbitrary LIKE expressions.
    return term.replace(/[\\%_]/g, "\\$&");
  }

  async function searchStudents(ui, client) {
    const pattern = normalizeQuery(ui.search.value);
    ui.students.disabled = true;
    ui.preview.disabled = true;
    ui.studentSummary.textContent = "Consultando alunos...";
    ui.result.hidden = true;
    clearArchiveReview(ui);

    const permission = await client.rpc("is_teacher_admin");
    if (permission.error || permission.data !== true) {
      throw new Error("Acesso administrativo não autorizado.");
    }

    const response = await client.from("profiles")
      .select("id,name,archived,enrolled")
      .ilike("name", "%" + pattern + "%")
      .order("name", { ascending: true })
      .limit(20);

    if (response.error || !Array.isArray(response.data)) {
      throw new Error("Não foi possível consultar a lista de alunos.");
    }
    const available = response.data.filter(function (student) {
      return student && typeof student.id === "string" &&
        (student.enrolled === true || student.archived === true);
    });
    replaceOptions(ui.students, "Selecione um aluno", available.map(function (student) {
      const description = student.archived === true ? " (arquivado)" : "";
      return option(String(student.name || "Aluno") + description, student.id);
    }));
    ui.students.disabled = available.length === 0;
    ui.studentSummary.textContent = available.length
      ? "Selecione um dos " + available.length + " resultados. Se necessário, refine o nome."
      : "Nenhum aluno ativo ou arquivado encontrado.";
  }

  async function selectStudent(ui, service) {
    clearArchiveReview(ui);
    ui.result.hidden = true;
    ui.preview.disabled = !ui.students.value;
    replaceOptions(ui.fromClassNumber, "Selecione o vínculo a substituir", []);
    if (!ui.students.value) {
      ui.studentSummary.textContent = "Selecione um aluno.";
      return;
    }

    const currentStudentId = ui.students.value;
    const plan = await service.plan({
      action: "inspect_student",
      studentId: currentStudentId
    });
    if (currentStudentId !== ui.students.value) return;
    if (!plan.snapshot) throw new Error("Não foi possível conferir os vínculos do aluno.");

    const classNumbers = plan.snapshot.classNumbers;
    replaceOptions(ui.fromClassNumber, "Selecione o vínculo a substituir",
      classNumbers.map(function (number) {
        return option("Turma " + number, String(number));
      }));
    const archived = plan.snapshot.archived ? "Arquivado" : "Ativo";
    const assignment = classNumbers.length ? classNumbers.join(", ") : "nenhuma";
    ui.studentSummary.textContent = archived + " · Vínculos atuais: " + assignment + ".";
  }

  async function loadClasses(ui, client) {
    const response = await client.rpc("get_teacher_classes_with_type");
    if (response.error || !Array.isArray(response.data)) {
      throw new Error("Não foi possível listar as turmas.");
    }
    const groups = response.data.filter(function (group) {
      return group && group.is_active === true && group.class_type === "quintet" &&
        Number.isInteger(group.class_number);
    });
    groups.sort(function (a, b) {
      return a.class_number - b.class_number;
    });
    replaceOptions(ui.classNumber, "Selecione a turma", groups.map(function (group) {
      return option(group.class_name || "Turma " + group.class_number,
        String(group.class_number));
    }));
  }

  async function initialize() {
    const ui = elements();
    ui.workspace.hidden = true;
    ui.preview.disabled = true;

    try {
      if (!window.Auth || !window.TeacherAcademicSecretarySupabase ||
          !window.TeacherAcademicArchiveExecutor) {
        throw new Error("Não foi possível inicializar os módulos acadêmicos.");
      }

      const user = await window.Auth.requireAuth({ skipProfileCheck: true });
      if (!user) return;
      if (!(await window.Auth.isTeacherAdmin())) {
        throw new Error("Esta página é exclusiva do professor administrador.");
      }

      const client = window.Auth.getClient();
      if (!client) throw new Error("Cliente Supabase não configurado.");
      const readers = window.TeacherAcademicSecretarySupabase
        .createSupabaseAcademicReaders(client);
      const service = window.TeacherAcademicSecretarySupabase
        .createAcademicSecretarySupabaseService(client);
      const archiveExecutor = window.TeacherAcademicArchiveExecutor
        .createSupervisedArchiveExecutor(client, readers);
      let archiveReview = null;
      await loadClasses(ui, client);

      ui.searchForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        archiveReview = null;
        clearArchiveReview(ui);
        ui.searchButton.disabled = true;
        try {
          await searchStudents(ui, client);
          setStatus(ui, "Busca concluída. Selecione um aluno.", false);
        } catch (error) {
          ui.students.disabled = true;
          ui.preview.disabled = true;
          setStatus(ui, error.message || "Erro ao consultar alunos.", true);
        } finally {
          ui.searchButton.disabled = false;
        }
      });

      ui.students.addEventListener("change", async function () {
        archiveReview = null;
        clearArchiveReview(ui);
        ui.preview.disabled = true;
        try {
          await selectStudent(ui, service);
          ui.preview.disabled = !ui.students.value;
        } catch (error) {
          ui.preview.disabled = true;
          setStatus(ui, error.message || "Não foi possível consultar o aluno.", true);
        }
      });

      ui.action.addEventListener("change", function () {
        archiveReview = null;
        showFields(ui);
      });
      ui.source.addEventListener("change", function () {
        archiveReview = null;
        showFields(ui);
      });
      ui.planForm.addEventListener("change", function () {
        archiveReview = null;
        clearArchiveReview(ui);
      });
      ui.planForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        archiveReview = null;
        clearArchiveReview(ui);
        ui.preview.disabled = true;
        ui.result.hidden = true;
        const request = formRequest(ui);
        try {
          const plan = await service.plan(request);
          if (request.studentId !== ui.students.value || request.action !== ui.action.value) {
            throw new Error("A seleção foi alterada. Gere outra prévia.");
          }
          renderPlan(ui, plan);
          if (plan.action === "archive" && plan.status === "ready_for_review" &&
              plan.snapshot && plan.snapshot.archived === false) {
            archiveReview = Object.freeze({
              action: "archive",
              studentId: plan.studentId,
              expectedClassNumbers: [...plan.snapshot.classNumbers]
            });
            const name = ui.students.selectedOptions[0].textContent;
            ui.archiveDetails.textContent = "Aluno: " + name +
              ". O arquivamento desvinculará todas as turmas e interromperá as novas cobranças mensais configuradas. O histórico será preservado.";
            ui.archiveConfirmation.hidden = false;
          }
          setStatus(ui, "Prévia concluída. Nenhum dado foi modificado.", false);
        } catch (error) {
          setStatus(ui, error.message || "Não foi possível gerar a prévia.", true);
        } finally {
          ui.preview.disabled = !ui.students.value;
        }
      });

      ui.archiveConsent.addEventListener("change", function () {
        ui.archiveExecute.disabled = !archiveReview || !ui.archiveConsent.checked;
      });

      ui.archiveExecute.addEventListener("click", async function () {
        if (!archiveReview || !ui.archiveConsent.checked ||
            ui.action.value !== "archive" || ui.students.value !== archiveReview.studentId) {
          return;
        }
        const selectedName = ui.students.selectedOptions[0].textContent;
        if (!window.confirm("Confirma o ARQUIVAMENTO de " + selectedName +
          "? O aluno será desvinculado de todas as turmas e as próximas cobranças serão suspensas.")) {
          return;
        }

        const request = { ...archiveReview, confirmed: true };
        archiveReview = null;
        clearArchiveReview(ui);
        ui.preview.disabled = true;
        ui.searchButton.disabled = true;
        ui.students.disabled = true;
        ui.action.disabled = true;
        try {
          const outcome = await archiveExecutor.executeArchive(request);
          ui.result.hidden = false;
          ui.resultStatus.textContent = "Arquivamento verificado. Aluno sem vínculos; mensalidades futuras suspensas.";
          ui.issues.replaceChildren();
          ui.steps.replaceChildren();
          setStatus(ui, "Arquivamento confirmado e verificado no Supabase.", false);
          try {
            await selectStudent(ui, service);
            ui.result.hidden = false;
          } catch (refreshError) {
            ui.studentSummary.textContent = "Arquivamento confirmado; atualize a página para consultar o novo estado.";
          }
          if (outcome.status !== "verified") {
            throw new Error("O resultado da operação não foi confirmado.");
          }
        } catch (error) {
          ui.result.hidden = true;
          setStatus(ui, "A operação não pôde ser confirmada. " +
            (error.message || "Verifique o cadastro antes de tentar novamente."), true);
        } finally {
          ui.action.disabled = false;
          ui.students.disabled = false;
          ui.searchButton.disabled = false;
          ui.preview.disabled = !ui.students.value;
        }
      });

      showFields(ui);
      ui.workspace.hidden = false;
      document.body.classList.remove("auth-checking");
      setStatus(ui, "Acesso administrativo autorizado. Modo somente leitura.", false);
    } catch (error) {
      ui.workspace.hidden = true;
      setStatus(ui, error.message || "Não foi possível verificar o acesso.", true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

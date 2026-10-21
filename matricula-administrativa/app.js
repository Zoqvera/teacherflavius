(function () {
  "use strict";

  const AUTH_RETRIES = 30;
  const AUTH_RETRY_MS = 150;
  const RPC_CLASSES = "get_teacher_classes_with_type";
  const RPC_ADMIN = "is_teacher_admin";
  const FUNCTION_CREATE = "create-administrative-student";
  const form = document.getElementById("enrollmentForm");
  const classInput = document.getElementById("classNumber");
  const firstDueInput = document.getElementById("firstDueDate");
  const pageStatus = document.getElementById("pageStatus");
  const formStatus = document.getElementById("formStatus");
  const submitButton = document.getElementById("submitButton");
  const classesByNumber = new Map();

  function todayInSaoPaulo() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return value.year + "-" + value.month + "-" + value.day;
  }

  function weekdayLabel(weekday) {
    return ({ 1: "Segunda-feira", 2: "Terça-feira", 3: "Quarta-feira",
      4: "Quinta-feira", 5: "Sexta-feira", 6: "Sábado", 7: "Domingo" })[weekday] || "Sem dia";
  }

  function timeLabel(value) {
    return String(value || "").slice(0, 5);
  }

  function setStatus(node, message, kind) {
    node.textContent = message;
    node.className = kind || "";
  }

  async function waitForAuth() {
    for (let attempt = 0; attempt < AUTH_RETRIES; attempt += 1) {
      if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return;
      await new Promise(resolve => setTimeout(resolve, AUTH_RETRY_MS));
    }
    throw new Error("O serviço de autenticação não está disponível.");
  }

  function redirectToLogin() {
    window.location.replace("/login/?next=" + encodeURIComponent("/matricula-administrativa/"));
  }

  function renderClasses(classes) {
    const sorted = classes.slice().sort((left, right) =>
      String(left.class_name || "").localeCompare(String(right.class_name || ""), "pt-BR", {
        numeric: true, sensitivity: "base",
      })
    );
    sorted.forEach(item => {
      if (!["individual", "quintet"].includes(item.class_type)
        || !item.class_weekday || !item.class_start_time) return;
      const option = document.createElement("option");
      option.value = String(item.class_number);
      option.textContent = (item.class_name || "Turma " + item.class_number)
        + " — " + weekdayLabel(item.class_weekday)
        + " " + timeLabel(item.class_start_time)
        + " (" + item.student_count + " inscritos)";
      classInput.appendChild(option);
      classesByNumber.set(Number(item.class_number), item);
    });
  }

  async function loadClasses(client) {
    const [classTypes, schedules] = await Promise.all([
      client.rpc(RPC_CLASSES),
      client.from("teacher_classes")
        .select("class_number,class_weekday,class_start_time,first_lesson_date")
        .eq("is_active", true),
    ]);
    if (classTypes.error) throw classTypes.error;
    if (schedules.error) throw schedules.error;
    const schedulesByNumber = new Map((schedules.data || []).map(item =>
      [Number(item.class_number), item]
    ));
    const classes = (classTypes.data || []).map(item =>
      Object.assign({}, item, schedulesByNumber.get(Number(item.class_number)) || {})
    );
    renderClasses(classes);
  }

  function selectedClass() {
    return classesByNumber.get(Number(classInput.value)) || null;
  }

  function updateClassHint() {
    const classItem = selectedClass();
    const hint = document.getElementById("classHint");
    hint.textContent = classItem
      ? "Primeira aula: " + weekdayLabel(classItem.class_weekday)
        + " às " + timeLabel(classItem.class_start_time)
        + ". Escolha a data real de início do aluno."
      : "Selecione uma turma para conferir o dia e horário.";
    document.getElementById("firstLessonDate").value = "";
  }

  function readForm() {
    const fields = new FormData(form);
    const data = Object.fromEntries(fields.entries());
    return window.AdminEnrollmentValidation.validateEnrollment(
      data, selectedClass(), todayInSaoPaulo()
    );
  }

  async function invokeCreate(client, payload) {
    const { data, error } = await client.functions.invoke(FUNCTION_CREATE, {
      body: payload,
    });
    if (error) {
      let message = error.message;
      try {
        const details = await error.context?.json();
        message = details?.error || message;
      } catch {
        // Fall back to the edge-client error message.
      }
      throw new Error(message);
    }
    if (!data || data.ok !== true) {
      throw new Error(data?.error || "Não foi possível confirmar a matrícula.");
    }
    return data.enrollment;
  }

  async function submitEnrollment(event) {
    event.preventDefault();
    setStatus(formStatus, "", "");
    let payload;
    try {
      payload = readForm();
    } catch (error) {
      setStatus(formStatus, error.message, "error");
      return;
    }
    submitButton.disabled = true;
    try {
      setStatus(formStatus, "Registrando matrícula...", "");
      const registration = await invokeCreate(Auth.getClient(), payload);
      setStatus(formStatus,
        "Matrícula concluída. Aluno vinculado à turma " + registration.class_number
        + "; primeira cobrança gerada em aberto para " + registration.first_due_date
        + ". Acesso ao portal bloqueado.", "success");
      form.reset();
      firstDueInput.value = todayInSaoPaulo();
      updateClassHint();
    } catch (error) {
      setStatus(formStatus, "Não foi possível matricular: " + error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function initialize() {
    try {
      await waitForAuth();
      const session = await Auth.getSession();
      if (!session?.user) return redirectToLogin();
      const client = Auth.getClient();
      const authorization = await client.rpc(RPC_ADMIN);
      if (authorization.error) throw authorization.error;
      if (authorization.data !== true) {
        setStatus(pageStatus, "Acesso restrito à área do professor.", "error");
        return;
      }
      await loadClasses(client);
      firstDueInput.value = todayInSaoPaulo();
      firstDueInput.min = todayInSaoPaulo();
      classInput.addEventListener("change", updateClassHint);
      form.addEventListener("submit", submitEnrollment);
      form.hidden = false;
      setStatus(pageStatus, classesByNumber.size
        ? "Informe os dados para criar a matrícula."
        : "Nenhuma turma regular ativa com horário definido foi encontrada.",
      classesByNumber.size ? "" : "error");
    } catch (error) {
      setStatus(pageStatus, "Falha ao carregar matrícula: " + error.message, "error");
    } finally {
      document.body.classList.remove("auth-checking");
    }
  }

  initialize();
})();

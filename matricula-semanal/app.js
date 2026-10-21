(function () {
  "use strict";

  const WEEKDAYS = [
    { day: 2, name: "Terça-feira" },
    { day: 3, name: "Quarta-feira" },
    { day: 4, name: "Quinta-feira" },
  ];
  const form = document.getElementById("weeklyEnrollmentForm");
  const classRows = document.getElementById("classRows");
  const pageStatus = document.getElementById("pageStatus");
  const formStatus = document.getElementById("formStatus");
  const saveButton = document.getElementById("saveWeekly");
  const classes = new Map();
  let teacherEmail = "";

  const localToday = () => {
    const fields = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const map = Object.fromEntries(fields.map(field => [field.type, field.value]));
    return [map.year, map.month, map.day].join("-");
  };

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T12:00:00Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function weekday(value) {
    return new Date(value + "T12:00:00Z").getUTCDay() || 7;
  }

  function setStatus(node, message, isError) {
    node.textContent = message;
    node.className = isError ? "error" : "";
  }

  function createClassRow(dayInfo) {
    const section = document.createElement("div");
    section.className = "fields";
    const classLabel = document.createElement("label");
    classLabel.textContent = dayInfo.name + " — 14h";
    const select = document.createElement("select");
    select.required = true;
    select.dataset.weekday = String(dayInfo.day);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecione";
    select.appendChild(placeholder);
    classes.get(dayInfo.day).forEach(classItem => {
      const option = document.createElement("option");
      option.value = String(classItem.class_number);
      option.textContent = classItem.class_name || "Turma " + classItem.class_number;
      select.appendChild(option);
    });
    classLabel.appendChild(select);
    const dateLabel = document.createElement("label");
    dateLabel.textContent = "Primeira aula nessa turma";
    const date = document.createElement("input");
    date.type = "date";
    date.required = true;
    date.min = localToday();
    date.dataset.firstLessonDay = String(dayInfo.day);
    dateLabel.appendChild(date);
    section.append(classLabel,dateLabel);
    classRows.appendChild(section);
  }

  async function loadClasses(client) {
    const [types, schedules] = await Promise.all([
      client.rpc("get_teacher_classes_with_type"),
      client.from("teacher_classes")
        .select("class_number,class_weekday,class_start_time,first_lesson_date")
        .eq("is_active", true),
    ]);
    if (types.error || schedules.error) {
      throw types.error || schedules.error;
    }
    const byNumber = new Map(schedules.data.map(c => [Number(c.class_number), c]));
    WEEKDAYS.forEach(({ day }) => {
      classes.set(day, types.data
        .map(type => Object.assign({}, type, byNumber.get(Number(type.class_number))))
        .filter(c => c.class_type === "individual"
          && Number(c.class_weekday) === day
          && String(c.class_start_time).slice(0, 5) === "14:00"));
    });
    WEEKDAYS.forEach(createClassRow);
    if (WEEKDAYS.some(({day}) => !classes.get(day).length)) {
      throw new Error("Falta uma turma individual ativa às 14h em um dos três dias.");
    }
  }

  function buildPayload() {
    const fields = new FormData(form);
    const firstDue = String(fields.get("first_due_date") || "");
    const weeklyFee = Number(fields.get("weekly_fee"));
    if (!isDate(firstDue) || weekday(firstDue) !== 2 || firstDue < localToday()) {
      throw new Error("O primeiro vencimento deve ser uma terça-feira futura ou hoje.");
    }
    if (!Number.isFinite(weeklyFee) || weeklyFee <= 0) {
      throw new Error("Informe um valor semanal válido.");
    }
    const selected = WEEKDAYS.map(({ day }) => {
      const classNumber = Number(classRows.querySelector(
        'select[data-weekday="' + day + '"]').value);
      const date = classRows.querySelector(
        'input[data-first-lesson-day="' + day + '"]').value;
      const classInfo = classes.get(day).find(c => Number(c.class_number) === classNumber);
      if (!classInfo || !isDate(date) || weekday(date) !== day || date < localToday()
        || (classInfo.first_lesson_date && date < classInfo.first_lesson_date)) {
        throw new Error("Confira a turma e a primeira aula de " +
          WEEKDAYS.find(info => info.day === day).name + ".");
      }
      return { class_number: classNumber, first_lesson_date: date };
    });
    const name = String(fields.get("name") || "").trim();
    const whatsapp = String(fields.get("whatsapp") || "").replace(/\D/g, "");
    if (name.length < 3) throw new Error("Informe o nome completo.");
    if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) {
      throw new Error("WhatsApp inválido.");
    }
    const contactEmail = String(fields.get("contact_email") || "").trim();
    if (contactEmail && contactEmail.toLowerCase() === teacherEmail) {
      throw new Error(
        "O e-mail de contato pertence à sua conta de professor. Desmarque a opção " +
        "'Incluir e-mail de contato' para matricular Silvia sem e-mail."
      );
    }
    return {
      billing_frequency: "weekly",
      name,
      whatsapp,
      contact_email: contactEmail,
      weekly_fee: Math.round(weeklyFee * 100) / 100,
      first_due_date: firstDue,
      classes: selected,
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    let payload;
    try { payload = buildPayload(); }
    catch (error) { return setStatus(formStatus, error.message, true); }
    saveButton.disabled = true;
    setStatus(formStatus, "Registrando matrícula...", false);
    try {
      const { data, error } = await Auth.getClient().functions.invoke(
        "create-administrative-student", { body: payload }
      );
      if (error) {
        let message = error.message;
        try { message = (await error.context?.json())?.error || message; }
        catch { /* Use the transport error. */ }
        throw new Error(message);
      }
      if (!data?.ok) throw new Error(data?.error || "Cadastro não confirmado.");
      setStatus(formStatus,
        "Matrícula confirmada nas três turmas. Primeira cobrança semanal: " +
        data.enrollment.first_due_date + ". Acesso do aluno bloqueado.",false);
      form.reset();
      form.elements.namedItem("contact_email").disabled = true;
    } catch (error) {
      setStatus(formStatus, "Não foi possível matricular: " + error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function initialize() {
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) break;
        await new Promise(resolve => setTimeout(resolve,150));
      }
      if (!window.Auth?.isConfigured()) throw new Error("Autenticação indisponível.");
      const session = await Auth.getSession();
      if (!session?.user) {
        window.location.replace("/login/?next=" + encodeURIComponent("/matricula-semanal/"));
        return;
      }
      teacherEmail = String(session.user.email || "").trim().toLowerCase();
      const client = Auth.getClient();
      const role = await client.rpc("is_teacher_admin");
      if (role.error || role.data !== true) throw new Error("Acesso exclusivo do professor.");
      await loadClasses(client);
      form.hidden = false;
      document.querySelector('input[name="first_due_date"]').min = localToday();
      const useEmail = form.elements.namedItem("enable_contact_email");
      const emailField = form.elements.namedItem("contact_email");
      emailField.disabled = true;
      emailField.value = "";
      useEmail.checked = false;
      useEmail.addEventListener("change", () => {
        emailField.disabled = !useEmail.checked;
        if (!useEmail.checked) emailField.value = "";
      });
      form.addEventListener("submit", handleSubmit);
      setStatus(pageStatus, "Preencha os dados e confirme as datas de início.", false);
    } catch (error) {
      setStatus(pageStatus, error.message, true);
    } finally {
      document.body.classList.remove("auth-checking");
    }
  }
  initialize();
})();

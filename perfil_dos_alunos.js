let currentProfessorSession = null;
let teacherClasses = [];
let studentClassMap = new Map();
let selectedStudentForClass = null;
let cachedVisibleStudents = [];
let currentStudentFilter = "all";
let studentBillingMap = new Map();
let selectedStudentForBilling = null;
let studentBillingLoaded = false;

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("perfil_dos_alunos.html");
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForAuthResources() {
  for (let i = 0; i < 10; i++) {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
    await sleep(150);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getStudentRefId(student) {
  return String(student.student_ref_id || student.user_id || student.id || student.invite_id || "");
}

function getStudentRefType(student) {
  return String(student.student_ref_type || (student.user_id ? "user" : "invite"));
}

function getStudentMapKey(refType, refId) {
  return String(refType || "user") + ":" + String(refId || "");
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isPreEnrolled(student) {
  const refType = getStudentRefType(student);
  const status = normalizeStatus(student.pre_enrollment_status || student.status);
  return refType === "invite" || status === "pending" || status === "pre_matriculado" || status === "pré-matriculado";
}

function isEnrolledStudent(student) {
  const status = normalizeStatus(student.pre_enrollment_status || student.status);
  return !isPreEnrolled(student) && (
    student.enrolled === true ||
    student.enrolled === "true" ||
    !!student.user_id ||
    status === "completed" ||
    status === "matriculado"
  );
}

function isVisibleStudent(student) {
  return (
    student.enrolled === true ||
    student.enrolled === "true" ||
    !!student.enrollment_code ||
    !!student.email ||
    !!student.user_id ||
    !!student.id ||
    !!student.invite_id ||
    normalizeStatus(student.pre_enrollment_status) === "pending"
  );
}

function hasAvailability(student) {
  const availability = student.availability || {};
  return Object.keys(availability).some(function (day) {
    return Array.isArray(availability[day]) && availability[day].length > 0;
  });
}

function getAssignedClasses(student) {
  const refId = getStudentRefId(student);
  const refType = getStudentRefType(student);
  const possibleKeys = [
    getStudentMapKey(refType, refId),
    getStudentMapKey("user", student.user_id || refId),
    getStudentMapKey("invite", student.invite_id || student.id || refId)
  ];

  const classes = [];
  possibleKeys.forEach(function (key) {
    const values = studentClassMap.get(key) || [];
    values.forEach(function (className) {
      if (!classes.includes(className)) classes.push(className);
    });
  });

  return classes;
}

function hasAssignedClass(student) {
  return getAssignedClasses(student).length > 0;
}

function getStudentBilling(student) {
  const studentId = student && (student.user_id || student.id);
  return studentId ? studentBillingMap.get(String(studentId)) || null : null;
}

function hasBillingConfigured(student) {
  const billing = getStudentBilling(student);
  return !!(billing && billing.monthly_fee != null);
}

function filterStudents(students) {
  if (currentStudentFilter === "without_class") {
    return students.filter(function (student) { return !hasAssignedClass(student); });
  }

  if (currentStudentFilter === "enrolled") {
    return students.filter(isEnrolledStudent);
  }

  if (currentStudentFilter === "without_billing") {
    if (!studentBillingLoaded) return [];
    return students.filter(function (student) {
      return isEnrolledStudent(student) && !hasBillingConfigured(student);
    });
  }

  if (currentStudentFilter === "availability") {
    return students.filter(hasAvailability);
  }

  if (currentStudentFilter === "pre_enrolled") {
    return students.filter(isPreEnrolled);
  }

  return students;
}

function getFilterMetadata() {
  const metadata = {
    all: {
      title: "Todos os alunos",
      heading: "Perfis completos",
      empty: "Nenhum aluno matriculado ou pré-matriculado encontrado."
    },
    without_class: {
      title: "Alunos sem turma",
      heading: "Alunos sem turma",
      empty: "Nenhum aluno sem turma encontrado."
    },
    enrolled: {
      title: "Alunos matriculados",
      heading: "Alunos matriculados",
      empty: "Nenhum aluno matriculado encontrado."
    },
    without_billing: {
      title: "Mensalidade não configurada",
      heading: "Alunos sem valor de mensalidade",
      empty: studentBillingLoaded
        ? "Todos os alunos matriculados já possuem um valor de mensalidade."
        : "Os valores de mensalidade não puderam ser carregados."
    },
    availability: {
      title: "Disponibilidade dos alunos",
      heading: "Alunos com disponibilidade informada",
      empty: "Nenhum aluno com disponibilidade informada encontrado."
    },
    pre_enrolled: {
      title: "Alunos pré-matriculados",
      heading: "Alunos pré-matriculados",
      empty: "Nenhum aluno pré-matriculado encontrado."
    }
  };

  return metadata[currentStudentFilter] || metadata.all;
}

function updateStudentCount(count) {
  const countEl = document.getElementById("studentCountNumber");
  if (countEl) countEl.textContent = String(count || 0);

  const titleEl = document.getElementById("studentCountTitle");
  const descriptionEl = document.getElementById("studentCountDescription");
  const metadata = getFilterMetadata();

  if (titleEl) titleEl.textContent = metadata.title;
  if (descriptionEl) descriptionEl.textContent = "Contagem atual conforme o filtro selecionado.";
}

function formatCpf(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 11) return value || "Não informado";
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function formatWhatsapp(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "Não informado";
  if (digits.length === 11) return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digits.length === 10) return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value || digits;
}

function formatAvailability(profile) {
  const days = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"]];
  const hourLabels = { "09": "9h - 10h", "10": "10h - 11h", "12": "12h - 13h", "13": "13h - 14h", "15": "15h - 16h", "17": "17h - 18h", "18": "18h - 19h", "20": "20h - 21h", "21": "21h - 22h" };
  const availability = profile.availability || {};
  const parts = days.map(function (day) {
    const values = Array.isArray(availability[day[0]]) ? availability[day[0]] : [];
    if (!values.length) return "";
    return '<p><b>' + day[1] + ':</b> ' + values.map(function (hour) { return escapeHtml(hourLabels[hour] || hour); }).join(", ") + '</p>';
  }).filter(Boolean);
  return parts.length ? parts.join("") : '<p>Não informado</p>';
}

function formatCreatedAt(value) {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Não configurada";
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getCurrentBillingMonth() {
  const today = new Date();
  return today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-01";
}

function setBillingStatusMessage(message, type) {
  const element = document.getElementById("billingStatusMessage");
  if (!element) return;
  element.hidden = !message;
  element.className = "billing-page-message" + (type ? " " + type : "");
  element.textContent = message || "";
}

function getStudentClassNames(student) {
  const classes = getAssignedClasses(student);
  return classes.length ? classes.join(", ") : "Nenhuma turma atribuída";
}

function formatAvailabilityForSpreadsheet(student) {
  const dayLabels = { seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta", sex: "Sexta" };
  const availability = student.availability || {};
  const parts = Object.keys(dayLabels).map(function (day) {
    const hours = Array.isArray(availability[day]) ? availability[day] : [];
    if (!hours.length) return "";
    return dayLabels[day] + ": " + hours.map(function (hour) { return hour + "h"; }).join(", ");
  }).filter(Boolean);
  return parts.length ? parts.join(" | ") : "Não informado";
}

function downloadEnrolledStudentsExcel() {
  const button = document.getElementById("downloadEnrolledStudentsButton");
  const students = cachedVisibleStudents.filter(isEnrolledStudent);

  if (!students.length) {
    alert("Nenhum aluno matriculado foi encontrado para exportação.");
    return;
  }

  if (!window.XLSX) {
    alert("Não foi possível carregar o gerador de Excel. Atualize a página e tente novamente.");
    return;
  }

  const headers = [
    "Nome completo",
    "E-mail",
    "CPF",
    "WhatsApp",
    "Chave PIX",
    "Código de matrícula",
    "Mensalidade (R$)",
    "Turma",
    "Data da matrícula",
    "Disponibilidade"
  ];

  const rows = students
    .slice()
    .sort(function (a, b) {
      return String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""), "pt-BR");
    })
    .map(function (student) {
      const enrollmentDate = student.created_at ? new Date(student.created_at) : "";
      return [
        student.name || "",
        student.email || "",
        String(student.cpf || ""),
        String(student.whatsapp || ""),
        student.pix_key || "",
        student.enrollment_code || "",
        hasBillingConfigured(student) ? Number(getStudentBilling(student).monthly_fee) : "",
        getStudentClassNames(student),
        enrollmentDate instanceof Date && !Number.isNaN(enrollmentDate.getTime()) ? enrollmentDate : "",
        formatAvailabilityForSpreadsheet(student)
      ];
    });

  const worksheet = XLSX.utils.aoa_to_sheet([headers].concat(rows), { cellDates: true });
  worksheet["!autofilter"] = { ref: "A1:J" + (rows.length + 1) };
  worksheet["!cols"] = [
    { wch: 30 },
    { wch: 32 },
    { wch: 16 },
    { wch: 17 },
    { wch: 26 },
    { wch: 20 },
    { wch: 18 },
    { wch: 24 },
    { wch: 20 },
    { wch: 52 }
  ];

  for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex++) {
    const feeCell = worksheet["G" + rowIndex];
    if (feeCell && feeCell.t === "n") feeCell.z = 'R$ #,##0.00';
    const dateCell = worksheet["I" + rowIndex];
    if (dateCell && dateCell.t === "d") dateCell.z = "dd/mm/yyyy hh:mm";
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Alunos matriculados");

  const today = new Date();
  const dateSuffix = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");

  try {
    button.disabled = true;
    button.textContent = "GERANDO ARQUIVO...";
    XLSX.writeFile(workbook, "alunos_matriculados_" + dateSuffix + ".xlsx", { compression: true });
  } finally {
    button.disabled = false;
    button.textContent = "BAIXAR ALUNOS MATRICULADOS EM EXCEL";
  }
}

function updateExcelDownloadButton() {
  const button = document.getElementById("downloadEnrolledStudentsButton");
  if (!button) return;
  const count = cachedVisibleStudents.filter(isEnrolledStudent).length;
  button.disabled = count === 0;
  button.title = count
    ? "Baixar dados de " + count + " aluno(s) matriculado(s)"
    : "Nenhum aluno matriculado disponível";
}

async function loadStudents() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_students");
  if (response.error) throw response.error;
  return response.data || [];
}

async function loadStudentBillingMap() {
  const response = await Auth.getClient().rpc("get_teacher_billing_students");
  if (response.error) throw response.error;

  const map = new Map();
  (response.data || []).forEach(function (item) {
    if (item.student_id) map.set(String(item.student_id), item);
  });

  studentBillingMap = map;
  studentBillingLoaded = true;
  return studentBillingMap;
}

async function refreshStudentBillingMap(options) {
  const showSuccess = options && options.showSuccess;
  try {
    await loadStudentBillingMap();
    setBillingStatusMessage(showSuccess ? "Valor da mensalidade atualizado com sucesso." : "", showSuccess ? "success" : "");
    return true;
  } catch (error) {
    studentBillingMap = new Map();
    studentBillingLoaded = false;
    setBillingStatusMessage(
      "Não foi possível carregar os valores das mensalidades: " + (error.message || "erro desconhecido") + ". Verifique a configuração da página Mensalidades.",
      "error"
    );
    return false;
  }
}

function getTeacherClassName(classItem) {
  return classItem.class_name || ("Turma " + classItem.class_number);
}

function compareTeacherClassesByName(firstClass, secondClass) {
  return getTeacherClassName(firstClass).localeCompare(
    getTeacherClassName(secondClass),
    "pt-BR",
    { numeric: true, sensitivity: "base" }
  );
}

async function loadTeacherClasses() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_classes");
  if (response.error) throw response.error;

  teacherClasses = (response.data || [])
    .slice()
    .sort(compareTeacherClassesByName);

  return teacherClasses;
}

async function loadStudentClassMap() {
  const client = Auth.getClient();
  const map = new Map();

  for (const classItem of teacherClasses) {
    const response = await client.rpc("get_teacher_class_students", { target_class_number: Number(classItem.class_number) });
    if (response.error) throw response.error;

    (response.data || []).forEach(function (row) {
      const refId = row.student_ref_id || row.user_id || row.invite_id || row.id;
      const refType = row.student_ref_type || (row.user_id ? "user" : "invite");
      const className = getTeacherClassName(classItem);
      [
        getStudentMapKey(refType, refId),
        row.user_id ? getStudentMapKey("user", row.user_id) : null,
        row.invite_id ? getStudentMapKey("invite", row.invite_id) : null
      ].filter(Boolean).forEach(function (key) {
        const current = map.get(key) || [];
        if (!current.includes(className)) current.push(className);
        map.set(key, current);
      });
    });
  }

  studentClassMap = map;
  return studentClassMap;
}

async function deleteStudent(userId, studentName, button) {
  const confirmed = window.confirm("Excluir definitivamente o aluno " + studentName + "? Esta ação remove a conta de login, o perfil, frequência e registros de exercícios vinculados a esse aluno.");
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "EXCLUINDO...";

  try {
    const client = Auth.getClient();
    const response = await client.rpc("delete_teacher_student", { target_user_id: userId });
    if (response.error) throw response.error;
    await loadStudentClassMap();
    await renderStudentProfiles();
  } catch (error) {
    alert("Não foi possível excluir o aluno: " + (error.message || "erro desconhecido") + ". Reexecute o arquivo supabase_professor_admin.sql no Supabase.");
    button.disabled = false;
    button.textContent = "EXCLUIR ALUNO";
  }
}

function openClassAssignmentModal(refId, refType, studentName) {
  selectedStudentForClass = { refId: refId, refType: refType, studentName: studentName };
  const modal = document.getElementById("classAssignmentModal");
  const nameLabel = document.getElementById("classAssignmentStudentName");
  const message = document.getElementById("classAssignmentMessage");
  const select = document.getElementById("classAssignmentSelect");

  if (nameLabel) nameLabel.textContent = "Aluno: " + studentName;
  if (message) {
    message.className = "empty";
    message.textContent = "";
  }

  if (select) {
    if (!teacherClasses.length) {
      select.innerHTML = '<option value="">Nenhuma turma criada</option>';
    } else {
      select.innerHTML = '<option value="">Selecione uma turma</option>' + teacherClasses.map(function (item) {
        return '<option value="' + escapeHtml(item.class_number) + '">' + escapeHtml(getTeacherClassName(item)) + '</option>';
      }).join("");
    }
  }

  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
}

function closeClassAssignmentModal() {
  const modal = document.getElementById("classAssignmentModal");
  selectedStudentForClass = null;
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function saveClassAssignment() {
  const message = document.getElementById("classAssignmentMessage");
  const select = document.getElementById("classAssignmentSelect");
  const button = document.getElementById("saveClassAssignmentButton");

  if (!selectedStudentForClass) return;
  const classNumber = select ? Number(select.value) : null;
  if (!classNumber) {
    message.className = "error";
    message.textContent = "Selecione uma turma.";
    return;
  }

  button.disabled = true;
  button.textContent = "SALVANDO...";
  message.className = "empty";
  message.textContent = "Atribuindo turma ao aluno...";

  try {
    const client = Auth.getClient();
    const response = await client.rpc("add_teacher_class_student_by_ref", {
      target_class_number: classNumber,
      target_student_ref_id: selectedStudentForClass.refId,
      target_student_ref_type: selectedStudentForClass.refType
    });
    if (response.error) throw response.error;

    await loadStudentClassMap();
    await renderStudentProfiles();
    closeClassAssignmentModal();
  } catch (error) {
    message.className = "error";
    message.textContent = "Não foi possível atribuir a turma: " + (error.message || "erro desconhecido") + ". Execute supabase_pre_matriculas_turmas.sql no Supabase.";
  } finally {
    button.disabled = false;
    button.textContent = "SALVAR TURMA";
  }
}

function setStudentBillingMessage(message, type) {
  const element = document.getElementById("studentBillingMessage");
  if (!element) return;
  element.className = type || "empty";
  element.textContent = message || "";
}

function openStudentBillingModal(studentId, studentName) {
  const settings = studentBillingMap.get(String(studentId)) || {};
  selectedStudentForBilling = {
    studentId: studentId,
    studentName: studentName,
    settings: settings
  };

  const modal = document.getElementById("studentBillingModal");
  const nameLabel = document.getElementById("studentBillingStudentName");
  const input = document.getElementById("studentMonthlyFee");

  if (nameLabel) nameLabel.textContent = "Aluno: " + studentName;
  if (input) input.value = settings.monthly_fee != null ? Number(settings.monthly_fee).toFixed(2) : "";
  setStudentBillingMessage("", "empty");

  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  if (input) window.setTimeout(function () { input.focus(); }, 0);
}

function closeStudentBillingModal() {
  const modal = document.getElementById("studentBillingModal");
  selectedStudentForBilling = null;
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function saveStudentBilling(event) {
  event.preventDefault();
  if (!selectedStudentForBilling) return;

  const input = document.getElementById("studentMonthlyFee");
  const button = document.getElementById("saveStudentBillingButton");
  const fee = Number(String(input ? input.value : "").replace(",", "."));

  if (!Number.isFinite(fee) || fee <= 0) {
    setStudentBillingMessage("Informe um valor de mensalidade maior que zero.", "error");
    return;
  }

  const selection = selectedStudentForBilling;
  const settings = selection.settings || {};
  const dueDay = Number(settings.due_day);
  const startMonth = settings.billing_start_month || getCurrentBillingMonth();
  const active = settings.monthly_fee == null ? true : settings.billing_active === true;

  button.disabled = true;
  button.textContent = "SALVANDO...";
  setStudentBillingMessage("Salvando o valor da mensalidade...", "empty");

  try {
    const client = Auth.getClient();
    const response = await client.rpc("save_student_billing_settings", {
      target_student_id: selection.studentId,
      target_monthly_fee: fee,
      target_due_day: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : 10,
      target_billing_start_month: startMonth,
      target_active: active,
      target_notes: settings.billing_notes || ""
    });
    if (response.error) throw response.error;

    const generation = await client.rpc("generate_monthly_tuition", {
      target_reference_month: getCurrentBillingMonth()
    });

    const refreshed = await refreshStudentBillingMap({ showSuccess: !generation.error });
    renderFilteredStudents();
    closeStudentBillingModal();

    if (generation.error && refreshed) {
      setBillingStatusMessage(
        "O valor foi salvo, mas a mensalidade do mês atual não pôde ser atualizada automaticamente: " + (generation.error.message || "erro desconhecido") + ".",
        "warning"
      );
    }
  } catch (error) {
    setStudentBillingMessage("Não foi possível salvar o valor: " + (error.message || "erro desconhecido"), "error");
  } finally {
    button.disabled = false;
    button.textContent = "SALVAR VALOR";
  }
}

function attachActionButtons() {
  document.querySelectorAll(".delete-student-button").forEach(function (button) {
    button.addEventListener("click", function () {
      deleteStudent(button.dataset.userId, button.dataset.studentName || "este aluno", button);
    });
  });

  document.querySelectorAll(".assign-class-button").forEach(function (button) {
    button.addEventListener("click", function () {
      openClassAssignmentModal(button.dataset.refId, button.dataset.refType, button.dataset.studentName || "Aluno");
    });
  });

  document.querySelectorAll(".billing-settings-button").forEach(function (button) {
    button.addEventListener("click", function () {
      openStudentBillingModal(button.dataset.studentId, button.dataset.studentName || "Aluno");
    });
  });
}

function renderProfileCard(student) {
  const preEnrolled = isPreEnrolled(student);
  const refId = getStudentRefId(student);
  const refType = getStudentRefType(student);
  const userId = student.user_id || "";
  const studentName = student.name || student.email || "Aluno sem nome";
  const assignedClasses = getStudentClassNames(student);
  const pillLabel = preEnrolled ? "Pré-matriculado" : "Matriculado";
  const sourceLabel = preEnrolled ? "Pré-matrícula por convite" : (student.source || "Não informado");
  const billing = getStudentBilling(student);
  const billingConfigured = !!(billing && billing.monthly_fee != null);
  const billingLabel = !studentBillingLoaded
    ? "Indisponível"
    : (preEnrolled ? "Disponível após matrícula" : (billingConfigured ? formatCurrency(billing.monthly_fee) : "Não configurada"));
  const billingClass = billingConfigured ? "configured" : (studentBillingLoaded && !preEnrolled ? "unconfigured" : "");

  const editButton = userId
    ? '<a class="delete-button" href="editar_aluno.html?id=' + encodeURIComponent(userId) + '" style="display:inline-flex; justify-content:center; text-decoration:none; border-color:rgba(129,140,248,0.45); background:rgba(129,140,248,0.10); color:#c4b5fd;">EDITAR DADOS</a>'
    : '<a class="delete-button" href="pre-matriculas.html" style="display:inline-flex; justify-content:center; text-decoration:none; border-color:rgba(129,140,248,0.45); background:rgba(129,140,248,0.10); color:#c4b5fd;">VER CONVITE</a>';

  const deleteButton = userId
    ? '<button class="delete-button delete-student-button" type="button" data-user-id="' + escapeHtml(userId) + '" data-student-name="' + escapeHtml(studentName) + '" style="border-color:rgba(248,113,113,0.55); background:rgba(248,113,113,0.10); color:#fca5a5;">EXCLUIR ALUNO</button>'
    : '';

  const billingButton = userId && !preEnrolled && studentBillingLoaded
    ? '<button class="delete-button billing-settings-button" type="button" data-student-id="' + escapeHtml(userId) + '" data-student-name="' + escapeHtml(studentName) + '" style="border-color:rgba(52,211,153,0.48); background:rgba(16,185,129,0.11); color:#a7f3d0;">' + (billingConfigured ? 'EDITAR MENSALIDADE' : 'DEFINIR MENSALIDADE') + '</button>'
    : '';

  return '<div class="student-card">' +
    '<strong>' + escapeHtml(studentName) +
      '<span class="pill ' + (preEnrolled ? 'pending' : '') + '">' + pillLabel + '</span>' +
    '</strong>' +
    '<p><b>Turma:</b> ' + escapeHtml(assignedClasses) + '</p>' +
    '<p><b>Código de convite / matrícula:</b> ' + escapeHtml(student.enrollment_code || "Não informado") + '</p>' +
    '<p><b>Nome completo:</b> ' + escapeHtml(student.name || "Não informado") + '</p>' +
    '<p><b>E-mail:</b> ' + escapeHtml(student.email || "Não informado") + '</p>' +
    '<p><b>CPF:</b> ' + escapeHtml(formatCpf(student.cpf)) + '</p>' +
    '<p><b>WhatsApp:</b> ' + escapeHtml(formatWhatsapp(student.whatsapp)) + '</p>' +
    '<p><b>Chave PIX:</b> ' + escapeHtml(student.pix_key || "Não informado") + '</p>' +
    '<p><b>Referência:</b> ' + escapeHtml(refType + ':' + refId) + '</p>' +
    '<p><b>Origem do registro:</b> ' + escapeHtml(sourceLabel) + '</p>' +
    '<p><b>Status da pré-matrícula:</b> ' + escapeHtml(student.pre_enrollment_status || (preEnrolled ? "pending" : "completed")) + '</p>' +
    '<p><b>Criado em:</b> ' + escapeHtml(formatCreatedAt(student.created_at)) + '</p>' +
    '<div class="student-billing-row"><b>Mensalidade</b><span class="billing-category ' + billingClass + '">' + escapeHtml(billingLabel) + '</span></div>' +
    '<div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08);">' +
      '<p><b>Disponibilidade para aulas:</b></p>' + formatAvailability(student) +
    '</div>' +
    '<div class="student-actions">' +
      '<button class="delete-button assign-class-button" type="button" data-ref-id="' + escapeHtml(refId) + '" data-ref-type="' + escapeHtml(refType) + '" data-student-name="' + escapeHtml(studentName) + '" style="border-color:rgba(129,140,248,0.45); background:rgba(129,140,248,0.10); color:#c4b5fd;">TURMA</button>' +
      billingButton +
      editButton +
      deleteButton +
    '</div>' +
  '</div>';
}

function renderFilteredStudents() {
  const list = document.getElementById("studentProfilesList");
  const title = document.getElementById("studentProfilesTitle");
  if (!list) return;

  const metadata = getFilterMetadata();
  const filteredStudents = filterStudents(cachedVisibleStudents);

  if (title) title.textContent = metadata.heading;
  updateStudentCount(filteredStudents.length);

  if (!filteredStudents.length) {
    list.className = "empty";
    list.textContent = metadata.empty;
    return;
  }

  list.className = "";
  list.innerHTML = filteredStudents.map(renderProfileCard).join("");
  attachActionButtons();
}

function applyStudentFilter(value) {
  currentStudentFilter = value || "all";
  const filterSelect = document.getElementById("studentStatusFilter");
  if (filterSelect && filterSelect.value !== currentStudentFilter) filterSelect.value = currentStudentFilter;
  renderFilteredStudents();
}

window.applyStudentFilter = applyStudentFilter;

async function renderStudentProfiles() {
  const list = document.getElementById("studentProfilesList");
  try {
    const students = await loadStudents();
    cachedVisibleStudents = students.filter(isVisibleStudent);
    updateExcelDownloadButton();
    renderFilteredStudents();
  } catch (error) {
    updateStudentCount(0);
    if (list) {
      list.className = "error";
      list.textContent = "Não foi possível carregar os perfis dos alunos: " + (error.message || "erro desconhecido") + ". Execute supabase_pre_matriculas_turmas.sql no Supabase.";
    }
  }
}

function setupFilterEvents() {
  const filterSelect = document.getElementById("studentStatusFilter");
  const downloadButton = document.getElementById("downloadEnrolledStudentsButton");

  if (filterSelect) {
    filterSelect.addEventListener("change", function () {
      applyStudentFilter(filterSelect.value || "all");
    });
  }

  if (downloadButton) {
    downloadButton.addEventListener("click", downloadEnrolledStudentsExcel);
  }
}

function setupModalEvents() {
  const closeButton = document.getElementById("closeClassAssignmentModalButton");
  const cancelButton = document.getElementById("cancelClassAssignmentButton");
  const saveButton = document.getElementById("saveClassAssignmentButton");
  const modal = document.getElementById("classAssignmentModal");
  const billingCloseButton = document.getElementById("closeStudentBillingModalButton");
  const billingCancelButton = document.getElementById("cancelStudentBillingButton");
  const billingForm = document.getElementById("studentBillingForm");
  const billingModal = document.getElementById("studentBillingModal");

  if (closeButton) closeButton.addEventListener("click", closeClassAssignmentModal);
  if (cancelButton) cancelButton.addEventListener("click", closeClassAssignmentModal);
  if (saveButton) saveButton.addEventListener("click", saveClassAssignment);
  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeClassAssignmentModal();
    });
  }

  if (billingCloseButton) billingCloseButton.addEventListener("click", closeStudentBillingModal);
  if (billingCancelButton) billingCancelButton.addEventListener("click", closeStudentBillingModal);
  if (billingForm) billingForm.addEventListener("submit", saveStudentBilling);
  if (billingModal) {
    billingModal.addEventListener("click", function (event) {
      if (event.target === billingModal) closeStudentBillingModal();
    });
  }
}

async function guardPage() {
  const status = document.getElementById("adminStatus");
  const resourcesReady = await waitForAuthResources();
  if (!resourcesReady) {
    status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.";
    document.body.classList.remove("auth-checking");
    return;
  }
  currentProfessorSession = await Auth.getSession();
  if (!currentProfessorSession || !currentProfessorSession.user) {
    redirectToLogin();
    return;
  }
  status.textContent = "Professor autenticado: " + currentProfessorSession.user.email + ".";
  document.body.classList.remove("auth-checking");
  setupModalEvents();
  setupFilterEvents();
  await loadTeacherClasses();
  await Promise.all([loadStudentClassMap(), refreshStudentBillingMap()]);
  await renderStudentProfiles();
}

guardPage();

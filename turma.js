let currentProfessorSession = null;
let currentClassNumber = null;
let currentClassName = null;
let allStudents = [];
let classStudentIds = new Set();
let modalSearchTerm = "";

function getClassNumber() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get("id"));
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("turma.html?id=" + currentClassNumber);
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
  return String(student.student_ref_id || student.user_id || student.invite_id || student.id || "");
}

function getStudentRefType(student) {
  return String(student.student_ref_type || (student.user_id ? "user" : "invite"));
}

function getStudentKey(student) {
  return getStudentRefType(student) + ":" + getStudentRefId(student);
}

function setClassTitle(className) {
  currentClassName = className || ("Turma " + currentClassNumber);
  const title = document.getElementById("classTitle");
  if (title) title.textContent = currentClassName;
  document.title = currentClassName + " - Teacher Flávio";
}

async function loadCurrentClassInfo() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_classes_with_type");
  if (response.error) throw response.error;
  const classes = response.data || [];
  const match = classes.find(function (item) {
    return Number(item.class_number) === Number(currentClassNumber);
  });
  if (!match) throw new Error("Turma não encontrada ou excluída.");
  if (match.class_type === "experimental") {
    window.location.replace("/aulas-experimentais/");
    throw new Error("Turmas EXPERIMENTAL são administradas no agendador de aulas experimentais.");
  }
  return match;
}

function formatDateInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
  return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
}

function parseBrazilianShortDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) throw new Error("Informe a data no formato DD/MM/AA.");
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("Data inválida. Use o formato DD/MM/AA.");
  }
  return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function formatBrazilianDate(value) {
  if (!value) return "Data não informada";
  const parts = String(value).split("-");
  if (parts.length === 3) return parts[2] + "/" + parts[1] + "/" + parts[0].slice(2);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function isEnrolled(student) {
  return student.enrolled === true || student.enrolled === "true" || !!student.enrollment_code || !!student.email || !!student.invite_id || student.pre_enrollment_status === "pending";
}

function getClassStudents() {
  return allStudents.filter(function (student) {
    return classStudentIds.has(getStudentKey(student));
  });
}

function getCurrentClassCapacity() {
  return Number(currentClassNumber) === 73 ? 5 : 4;
}

function getAvailableStudents() {
  return allStudents.filter(function (student) {
    return !classStudentIds.has(getStudentKey(student));
  });
}

async function loadStudents() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_students");
  if (response.error) throw response.error;
  return (response.data || []).filter(isEnrolled);
}

async function loadClassStudents() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_class_students", { target_class_number: currentClassNumber });
  if (response.error) throw response.error;
  return response.data || [];
}

async function loadClassResources() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_class_resources", { target_class_number: currentClassNumber });
  if (response.error) throw response.error;
  return response.data && response.data.length ? response.data[0] : null;
}

async function loadClassHistory() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_class_activity_history", { target_class_number: currentClassNumber });
  if (response.error) throw response.error;
  return response.data || [];
}

function cleanClassNotes(notes) {
  return String(notes || "").replace(/^\[Turma\s+\d+\]\s*/i, "").trim();
}

function groupHistoryByClassDate(records) {
  return records.reduce(function (groups, record) {
    const dateKey = record.class_date || "sem-data";
    const notesKey = cleanClassNotes(record.class_notes || "");
    const key = dateKey + "||" + notesKey;
    if (!groups[key]) groups[key] = { classDate: record.class_date, notes: notesKey, records: [] };
    groups[key].records.push(record);
    return groups;
  }, {});
}

function renderHistoryCard(group) {
  const studentsHtml = group.records.map(function (record) {
    const preLabel = record.student_ref_type === "invite" ? " — pré-matriculado" : "";
    return '<p><b>' + escapeHtml(record.student_name || "Aluno sem nome") + ':</b> ' +
      escapeHtml(record.attendance_status || "Sem status") + preLabel +
      (record.student_email ? ' — ' + escapeHtml(record.student_email) : '') +
    '</p>';
  }).join("");

  return '<div class="history-card">' +
    '<strong>Aula de ' + escapeHtml(formatBrazilianDate(group.classDate)) + '</strong>' +
    '<p><b>Atividade registrada:</b> ' + escapeHtml(group.notes || "Sem descrição registrada") + '</p>' +
    '<p><b>Total de registros:</b> ' + group.records.length + '</p>' +
    '<div class="student-list">' + studentsHtml + '</div>' +
  '</div>';
}

async function renderClassHistory() {
  const list = document.getElementById("classHistoryList");
  if (!list) return;
  try {
    const records = await loadClassHistory();
    if (!records.length) {
      list.className = "empty";
      list.textContent = "Nenhuma aula foi registrada para os alunos desta turma ainda.";
      return;
    }
    const groups = groupHistoryByClassDate(records);
    list.className = "";
    list.innerHTML = Object.keys(groups).map(function (key) { return renderHistoryCard(groups[key]); }).join("");
  } catch (error) {
    list.className = "error";
    list.textContent = "Não foi possível carregar o histórico da turma. Execute supabase_pre_matriculas_turmas.sql no Supabase.";
  }
}

async function renderClassResources() {
  const message = document.getElementById("classResourcesMessage");
  try {
    const resources = await loadClassResources();
    document.getElementById("videoLessonUrl").value = resources && resources.video_lesson_url ? resources.video_lesson_url : "";
    document.getElementById("lessonMaterialUrl").value = resources && resources.lesson_material_url ? resources.lesson_material_url : "";
    document.getElementById("recordedLessonsUrl").value = resources && resources.recorded_lessons_url ? resources.recorded_lessons_url : "";
    document.getElementById("whatsappGroupUrl").value = resources && resources.whatsapp_group_url ? resources.whatsapp_group_url : "";
    if (message) {
      message.className = "empty";
      message.textContent = resources ? "Links carregados." : "Nenhum link cadastrado para esta turma.";
    }
  } catch (error) {
    if (message) {
      message.className = "error";
      message.textContent = "Não foi possível carregar os links da turma. Reexecute supabase_aulas_gravadas.sql no Supabase.";
    }
  }
}

async function saveClassResources(event) {
  event.preventDefault();
  const message = document.getElementById("classResourcesMessage");
  message.className = "empty";
  message.textContent = "Salvando links...";
  try {
    const client = Auth.getClient();
    const response = await client.rpc("save_teacher_class_resources", {
      target_class_number: currentClassNumber,
      target_video_lesson_url: document.getElementById("videoLessonUrl").value.trim(),
      target_lesson_material_url: document.getElementById("lessonMaterialUrl").value.trim(),
      target_recorded_lessons_url: document.getElementById("recordedLessonsUrl").value.trim(),
      target_whatsapp_group_url: document.getElementById("whatsappGroupUrl").value.trim()
    });
    if (response.error) throw response.error;
    message.className = "empty";
    message.textContent = "Links da turma salvos.";
  } catch (error) {
    message.className = "error";
    message.textContent = "Não foi possível salvar os links: " + (error.message || "erro desconhecido") + ". Reexecute supabase_aulas_gravadas.sql no Supabase.";
  }
}

async function addSelectedStudentsToClass() {
  const button = document.getElementById("addSelectedStudentsButton");
  const message = document.getElementById("modalStudentsMessage");
  const selected = Array.from(document.querySelectorAll(".modal-student-checkbox:checked")).map(function (checkbox) {
    return { refId: checkbox.dataset.refId, refType: checkbox.dataset.refType };
  });

  if (!selected.length) {
    message.className = "error";
    message.textContent = "Selecione pelo menos um aluno.";
    return;
  }

  const remainingSpots = getCurrentClassCapacity() - getClassStudents().length;
  if (remainingSpots <= 0) {
    message.className = "error";
    message.textContent = "Esta turma já atingiu o limite máximo de " + getCurrentClassCapacity() + " alunos.";
    return;
  }
  if (selected.length > remainingSpots) {
    message.className = "error";
    message.textContent = "Selecione no máximo " + remainingSpots + (remainingSpots === 1 ? " aluno. Há somente uma vaga disponível." : " alunos. Esse é o número de vagas disponíveis.");
    return;
  }

  button.disabled = true;
  button.textContent = "ADICIONANDO...";
  message.className = "empty";
  message.textContent = "Adicionando alunos selecionados...";

  try {
    const client = Auth.getClient();
    for (const item of selected) {
      const response = await client.rpc("add_teacher_class_student_by_ref", {
        target_class_number: currentClassNumber,
        target_student_ref_id: item.refId,
        target_student_ref_type: item.refType
      });
      if (response.error) throw response.error;
    }
    await refreshLists();
    closeStudentsModal();
  } catch (error) {
    message.className = "error";
    message.textContent = "Não foi possível adicionar os alunos: " + (error.message || "erro desconhecido") + ".";
  } finally {
    button.disabled = false;
    button.textContent = "ADICIONAR ALUNOS SELECIONADOS";
  }
}

async function removeStudentFromClass(refId, refType, button) {
  const confirmed = window.confirm("Remover este aluno de " + (currentClassName || "Turma " + currentClassNumber) + "?");
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = "REMOVENDO...";
  try {
    const client = Auth.getClient();
    const response = await client.rpc("remove_teacher_class_student_by_ref", {
      target_class_number: currentClassNumber,
      target_student_ref_id: refId,
      target_student_ref_type: refType
    });
    if (response.error) throw response.error;
    await refreshLists();
  } catch (error) {
    alert("Não foi possível remover o aluno: " + (error.message || "erro desconhecido") + ". Execute supabase_pre_matriculas_turmas.sql no Supabase.");
    button.disabled = false;
    button.textContent = "REMOVER DA TURMA";
  }
}

function renderStudentCard(student, action) {
  const refId = escapeHtml(getStudentRefId(student));
  const refType = escapeHtml(getStudentRefType(student));
  const name = escapeHtml(student.name || student.student_name || student.email || "Aluno sem nome");
  const email = escapeHtml(student.email || student.student_email || "Não informado");
  const enrollmentCode = escapeHtml(student.enrollment_code || "Não informado");
  const preLabel = getStudentRefType(student) === "invite" ? ' <span class="pill pending">Pré-matriculado</span>' : '';
  const button = action === "remove" ? '<button class="delete-button remove-class-student" data-ref-id="' + refId + '" data-ref-type="' + refType + '">REMOVER DA TURMA</button>' : '';

  return '<div class="student-card">' +
    '<strong>' + name + preLabel + '</strong>' +
    '<p><b>E-mail:</b> ' + email + '</p>' +
    '<p><b>Código:</b> ' + enrollmentCode + '</p>' +
    button +
  '</div>';
}

function renderModalStudentOption(student) {
  const refId = escapeHtml(getStudentRefId(student));
  const refType = escapeHtml(getStudentRefType(student));
  const name = escapeHtml(student.name || student.email || "Aluno sem nome");
  const email = escapeHtml(student.email || "Não informado");
  const enrollmentCode = escapeHtml(student.enrollment_code || "Não informado");
  const status = getStudentRefType(student) === "invite" ? "Pré-matriculado" : "Matriculado";
  return '<label class="modal-student-option">' +
    '<input class="modal-student-checkbox" type="checkbox" value="' + refType + ':' + refId + '" data-ref-id="' + refId + '" data-ref-type="' + refType + '" />' +
    '<span><strong>' + name + '</strong><span>' + email + '</span><span>' + status + ' · Código: ' + enrollmentCode + '</span></span>' +
  '</label>';
}

function studentMatchesSearch(student, term) {
  if (!term) return true;
  const haystack = [student.name, student.email, student.enrollment_code, student.cpf, student.whatsapp, student.pre_enrollment_status]
    .map(function (value) { return String(value || "").toLowerCase(); })
    .join(" ");
  return haystack.includes(term.toLowerCase());
}

function renderAvailableStudentsModal() {
  const list = document.getElementById("availableStudentsList");
  const message = document.getElementById("modalStudentsMessage");
  if (!list) return;
  const remainingSpots = getCurrentClassCapacity() - getClassStudents().length;
  if (remainingSpots <= 0) {
    list.className = "empty";
    list.textContent = "Esta turma já atingiu o limite máximo de " + getCurrentClassCapacity() + " alunos.";
    if (message) message.textContent = "";
    return;
  }
  const availableStudents = getAvailableStudents().filter(function (student) {
    return studentMatchesSearch(student, modalSearchTerm);
  });
  if (!availableStudents.length) {
    list.className = "empty";
    list.textContent = getAvailableStudents().length ? "Nenhum aluno encontrado para essa busca." : "Não há alunos disponíveis para adicionar a esta turma.";
    if (message) message.textContent = "";
    return;
  }
  list.className = "modal-student-list";
  list.innerHTML = availableStudents.map(renderModalStudentOption).join("");
  if (message) {
    message.className = "empty";
    message.textContent = availableStudents.length + " aluno(s) disponível(is). Restam " + remainingSpots + (remainingSpots === 1 ? " vaga nesta turma." : " vagas nesta turma.");
  }
}

function openStudentsModal() {
  const modal = document.getElementById("studentsModal");
  const search = document.getElementById("studentModalSearch");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  modalSearchTerm = "";
  if (search) search.value = "";
  renderAvailableStudentsModal();
}

function closeStudentsModal() {
  const modal = document.getElementById("studentsModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function renderAttendanceStudents() {
  const list = document.getElementById("attendanceStudentsList");
  if (!list) return;
  const classStudents = getClassStudents();
  if (!classStudents.length) {
    list.className = "empty";
    list.textContent = "Adicione alunos à turma antes de registrar uma aula.";
    return;
  }
  list.className = "";
  list.innerHTML = classStudents.map(function (student) {
    const refId = escapeHtml(getStudentRefId(student));
    const refType = escapeHtml(getStudentRefType(student));
    const name = escapeHtml(student.name || student.email || "Aluno sem nome");
    const email = escapeHtml(student.email || "Não informado");
    const preLabel = getStudentRefType(student) === "invite" ? " · Pré-matriculado" : "";
    return '<div class="class-attendance-row">' +
      '<label><input type="checkbox" class="attendance-student-check" data-ref-id="' + refId + '" data-ref-type="' + refType + '" checked />' + name + preLabel + '</label>' +
      '<p style="color:#94a3b8; font-size:13px; margin-bottom:8px;"><b>E-mail:</b> ' + email + '</p>' +
      '<select class="attendance-status" data-ref-id="' + refId + '" data-ref-type="' + refType + '">' +
        '<option value="Compareceu">Compareceu</option>' +
        '<option value="Faltou">Faltou</option>' +
      '</select>' +
      '<textarea class="attendance-notes" data-ref-id="' + refId + '" data-ref-type="' + refType + '" placeholder="Observação individual opcional para este aluno..."></textarea>' +
    '</div>';
  }).join("");
}

function attachClassButtons() {
  document.querySelectorAll(".remove-class-student").forEach(function (button) {
    button.addEventListener("click", function () { removeStudentFromClass(button.dataset.refId, button.dataset.refType, button); });
  });
}

function renderLists() {
  const classList = document.getElementById("classStudentsList");
  const classStudents = getClassStudents();
  if (!classStudents.length) {
    classList.className = "empty";
    classList.textContent = "Nenhum aluno adicionado a esta turma ainda.";
  } else {
    classList.className = "";
    classList.innerHTML = classStudents.map(function (student) { return renderStudentCard(student, "remove"); }).join("");
  }
  const addButton = document.getElementById("openStudentsModalButton");
  if (addButton) {
    const isFull = classStudents.length >= getCurrentClassCapacity();
    addButton.disabled = isFull;
    addButton.title = isFull ? "Turma com limite máximo de alunos atingido" : "Adicionar alunos à turma";
  }
  renderAttendanceStudents();
  renderAvailableStudentsModal();
  attachClassButtons();
}

async function refreshLists() {
  const classRows = await loadClassStudents();
  classStudentIds = new Set(classRows.map(function (row) {
    const refId = row.student_ref_id || row.user_id || row.invite_id;
    const refType = row.student_ref_type || (row.user_id ? "user" : "invite");
    return refType + ":" + refId;
  }));
  renderLists();
  await renderClassHistory();
}

async function saveClassAttendance(event) {
  event.preventDefault();
  const message = document.getElementById("attendanceMessage");
  message.className = "empty";
  message.textContent = "Salvando frequência...";
  try {
    const classDate = parseBrazilianShortDate(document.getElementById("classDate").value);
    const generalNotes = document.getElementById("classNotes").value.trim();
    const selectedChecks = Array.from(document.querySelectorAll(".attendance-student-check:checked"));
    if (!selectedChecks.length) throw new Error("Selecione pelo menos um aluno para registrar a aula.");
    const attendanceRecords = selectedChecks.map(function (checkbox) {
      const refId = checkbox.dataset.refId;
      const refType = checkbox.dataset.refType;
      const statusInput = document.querySelector('.attendance-status[data-ref-id="' + refId + '"][data-ref-type="' + refType + '"]');
      const notesInput = document.querySelector('.attendance-notes[data-ref-id="' + refId + '"][data-ref-type="' + refType + '"]');
      return {
        student_ref_id: refId,
        student_ref_type: refType,
        attendance_status: statusInput ? statusInput.value : "Compareceu",
        class_notes: notesInput && notesInput.value.trim() ? notesInput.value.trim() : generalNotes
      };
    });
    const client = Auth.getClient();
    const response = await client.rpc("save_teacher_class_attendance_by_ref", {
      target_class_number: currentClassNumber,
      target_class_date: classDate,
      target_general_notes: generalNotes,
      attendance_records: attendanceRecords
    });
    if (response.error) throw response.error;
    document.getElementById("classAttendanceForm").reset();
    renderAttendanceStudents();
    await renderClassHistory();
    message.className = "empty";
    message.textContent = "Frequência da aula salva.";
  } catch (error) {
    message.className = "error";
    message.textContent = error.message || "Não foi possível salvar a frequência.";
  }
}

async function guardPage() {
  const status = document.getElementById("adminStatus");
  currentClassNumber = getClassNumber();
  if (!currentClassNumber) {
    document.getElementById("classTitle").textContent = "Turma inválida";
    status.textContent = "Informe uma turma válida.";
    document.body.classList.remove("auth-checking");
    return;
  }
  setClassTitle("Carregando turma...");
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
  try {
    status.textContent = "Professor autenticado: " + currentProfessorSession.user.email + ".";
    const classInfo = await loadCurrentClassInfo();
    setClassTitle(classInfo.class_name || ("Turma " + currentClassNumber));
    allStudents = await loadStudents();
    await renderClassResources();
    await refreshLists();
    document.body.classList.remove("auth-checking");
  } catch (error) {
    status.textContent = "Não foi possível carregar a turma: " + (error.message || "erro desconhecido") + ". Execute supabase_pre_matriculas_turmas.sql no Supabase.";
    document.body.classList.remove("auth-checking");
  }
}

const classDateInput = document.getElementById("classDate");
if (classDateInput) classDateInput.addEventListener("input", function () { this.value = formatDateInput(this.value); });
const classResourcesForm = document.getElementById("classResourcesForm");
if (classResourcesForm) classResourcesForm.addEventListener("submit", saveClassResources);
const classAttendanceForm = document.getElementById("classAttendanceForm");
if (classAttendanceForm) classAttendanceForm.addEventListener("submit", saveClassAttendance);
const openStudentsModalButton = document.getElementById("openStudentsModalButton");
if (openStudentsModalButton) openStudentsModalButton.addEventListener("click", openStudentsModal);
const closeStudentsModalButton = document.getElementById("closeStudentsModalButton");
if (closeStudentsModalButton) closeStudentsModalButton.addEventListener("click", closeStudentsModal);
const cancelStudentsModalButton = document.getElementById("cancelStudentsModalButton");
if (cancelStudentsModalButton) cancelStudentsModalButton.addEventListener("click", closeStudentsModal);
const addSelectedStudentsButton = document.getElementById("addSelectedStudentsButton");
if (addSelectedStudentsButton) addSelectedStudentsButton.addEventListener("click", addSelectedStudentsToClass);
const studentModalSearch = document.getElementById("studentModalSearch");
if (studentModalSearch) {
  studentModalSearch.addEventListener("input", function () {
    modalSearchTerm = studentModalSearch.value.trim();
    renderAvailableStudentsModal();
  });
}
const studentsModal = document.getElementById("studentsModal");
if (studentsModal) {
  studentsModal.addEventListener("click", function (event) {
    if (event.target === studentsModal) closeStudentsModal();
  });
}

guardPage();

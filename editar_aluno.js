let currentProfessorSession = null;
let currentStudentId = null;
let currentStudent = null;

const availabilityDays = [
  { key: "seg", label: "Seg" },
  { key: "ter", label: "Ter" },
  { key: "qua", label: "Qua" },
  { key: "qui", label: "Qui" },
  { key: "sex", label: "Sex" }
];
const availabilityFullNames = { seg: "Segunda", ter: "Terça", qua: "Quarta", qui: "Quinta", sex: "Sexta" };
const availabilityHours = [
  { key: "09", label: "9h - 10h" },
  { key: "10", label: "10h - 11h" },
  { key: "12", label: "12h - 13h" },
  { key: "13", label: "13h - 14h" },
  { key: "15", label: "15h - 16h" },
  { key: "17", label: "17h - 18h" },
  { key: "18", label: "18h - 19h" },
  { key: "20", label: "20h - 21h" },
  { key: "21", label: "21h - 22h" }
];

function getStudentId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("editar_aluno.html?id=" + (currentStudentId || ""));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForAuthResources() {
  for (let i = 0; i < 10; i++) {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
    await sleep(150);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
}

function onlyDigits(value) { return String(value || "").replace(/\D/g, ""); }

function formatCpf(value) {
  const digits = onlyDigits(value).slice(0, 11);
  return digits.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function normalizeAvailability(availability) {
  const normalized = { seg: [], ter: [], qua: [], qui: [], sex: [] };
  availabilityDays.forEach(function (day) {
    const selected = Array.isArray(availability && availability[day.key]) ? availability[day.key] : [];
    normalized[day.key] = selected.filter(function (hour) {
      return availabilityHours.some(function (item) { return item.key === hour; });
    });
  });
  return normalized;
}

function buildAvailabilityGrid() {
  const grid = document.getElementById("availabilityGrid");
  grid.innerHTML = '<div></div>' + availabilityDays.map(day => `<div class="grid-head" title="${availabilityFullNames[day.key]}">${day.label}</div>`).join("");
  availabilityHours.forEach(hour => {
    grid.insertAdjacentHTML("beforeend", `<div class="time-label">${hour.label}</div>`);
    availabilityDays.forEach(day => {
      const id = `availability_${day.key}_${hour.key}`;
      grid.insertAdjacentHTML("beforeend", `
        <label class="slot" for="${id}" title="${availabilityFullNames[day.key]}, ${hour.label}">
          <input type="checkbox" id="${id}" name="availability" data-day="${day.key}" data-hour="${hour.key}" />
          <span class="slot-box"></span>
        </label>
      `);
    });
  });
}

function getAvailability() {
  const availability = { seg: [], ter: [], qua: [], qui: [], sex: [] };
  document.querySelectorAll('input[name="availability"]:checked').forEach(input => {
    availability[input.dataset.day].push(input.dataset.hour);
  });
  return availability;
}

function setAvailability(availability) {
  const normalized = normalizeAvailability(availability);
  document.querySelectorAll('input[name="availability"]').forEach(input => {
    input.checked = Array.isArray(normalized[input.dataset.day]) && normalized[input.dataset.day].includes(input.dataset.hour);
  });
}

async function loadStudents() {
  const client = Auth.getClient();
  const response = await client.rpc("get_teacher_students");
  if (response.error) throw response.error;
  return response.data || [];
}

function fillForm(student) {
  document.getElementById("studentName").value = student.name || "";
  document.getElementById("studentEmail").value = student.email || "";
  document.getElementById("studentCpf").value = formatCpf(student.cpf || "");
  document.getElementById("studentWhatsapp").value = student.whatsapp || "";
  document.getElementById("studentPixKey").value = student.pix_key || "";
  document.getElementById("studentEnrollmentCode").value = student.enrollment_code || "";
  setAvailability(student.availability || {});
  const origin = student.acquisition || {};
  window.StudentAcquisition.setup("studentAcquisitionSource", "studentAcquisitionDetail", origin.source, origin.detail);
  document.getElementById("studentAcquisitionProvenance").textContent = origin.recorded_via
    ? "Origem registrada por: " + ({ teacher: "professor", student: "aluno", reservation: "reserva", trial: "aula experimental" }[origin.recorded_via] || origin.recorded_via)
    : "Origem ainda não informada.";
}

async function saveStudent(event) {
  event.preventDefault();
  const message = document.getElementById("editStudentMessage");
  message.className = "empty";
  message.textContent = "Salvando alterações...";

  try {
    const cleanCpf = onlyDigits(document.getElementById("studentCpf").value);
    const cleanWhatsapp = onlyDigits(document.getElementById("studentWhatsapp").value);
    if (cleanCpf.length !== 11) throw new Error("CPF inválido. Informe 11 dígitos.");
    if (cleanWhatsapp.length < 10) throw new Error("WhatsApp inválido.");

    const acquisition = window.StudentAcquisition.read("studentAcquisitionSource", "studentAcquisitionDetail", false);
    const client = Auth.getClient();
    const response = await client.rpc("update_teacher_student_profile", {
      target_user_id: currentStudentId,
      target_name: document.getElementById("studentName").value.trim(),
      target_email: document.getElementById("studentEmail").value.trim(),
      target_cpf: cleanCpf,
      target_whatsapp: cleanWhatsapp,
      target_pix_key: document.getElementById("studentPixKey").value.trim(),
      target_enrollment_code: document.getElementById("studentEnrollmentCode").value.trim(),
      target_availability: getAvailability()
    });

    if (response.error) throw response.error;
    const sourceResponse = await client.rpc("set_teacher_student_acquisition", {
      target_student_id: currentStudentId,
      target_source: acquisition.source,
      target_detail: acquisition.detail
    });
    if (sourceResponse.error) throw new Error("Os dados cadastrais foram salvos, mas a origem não: " + sourceResponse.error.message);
    message.className = "empty";
    message.textContent = "Dados do aluno atualizados.";
  } catch (error) {
    message.className = "error";
    message.textContent = "Não foi possível salvar: " + (error.message || "erro desconhecido") + ". Reexecute supabase_professor_admin.sql no Supabase.";
  }
}

async function guardPage() {
  const status = document.getElementById("adminStatus");
  currentStudentId = getStudentId();
  buildAvailabilityGrid();

  if (!currentStudentId) {
    status.textContent = "Aluno não informado.";
    document.body.classList.remove("auth-checking");
    return;
  }

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
    const [students, originsResponse] = await Promise.all([
      loadStudents(),
      Auth.getClient().rpc("get_teacher_student_acquisitions")
    ]);
    if (originsResponse.error) throw originsResponse.error;
    const origins = new Map((originsResponse.data || []).map(item => [String(item.student_id), item]));
    currentStudent = students.find(function (student) {
      return String(student.user_id || student.id) === String(currentStudentId);
    });
    if (!currentStudent) throw new Error("Aluno não encontrado.");
    currentStudent.acquisition = origins.get(String(currentStudentId)) || null;
    fillForm(currentStudent);
    status.textContent = "Professor autenticado: " + currentProfessorSession.user.email + ". Editando: " + (currentStudent.name || currentStudent.email || "aluno") + ".";
    document.body.classList.remove("auth-checking");
  } catch (error) {
    status.textContent = "Não foi possível carregar o aluno: " + (error.message || "erro desconhecido") + ". Reexecute supabase_professor_admin.sql no Supabase.";
    document.body.classList.remove("auth-checking");
  }
}

document.getElementById("studentCpf").addEventListener("input", function () { this.value = formatCpf(this.value); });
document.getElementById("editStudentForm").addEventListener("submit", saveStudent);

guardPage();

let currentAdminSession = null;
let makeupClasses = [];

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitForAuthResources() {
  for (let index = 0; index < 10; index += 1) {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
    await sleep(150);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
}

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("reposicoes_admin.html");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo"
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo"
  }).format(date);
}

function calculateOneHourEndTime(startTime) {
  const parts = String(startTime || "").split(":").map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;

  const totalMinutes = (parts[0] * 60) + parts[1] + 60;
  if (totalMinutes >= 24 * 60) return null;

  const endHours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const endMinutes = String(totalMinutes % 60).padStart(2, "0");
  return endHours + ":" + endMinutes;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function getSelectedClass() {
  const value = document.getElementById("slotClass").value;
  if (!value) return null;
  return makeupClasses.find(function (item) {
    return Number(item.class_number) === Number(value);
  }) || null;
}

function updateClassLinkPreview() {
  const selectedClass = getSelectedClass();
  const input = document.getElementById("slotMeetingUrl");
  const link = document.getElementById("slotMeetingLink");
  const button = document.getElementById("createSlotButton");
  const meetingUrl = selectedClass ? String(selectedClass.video_lesson_url || "").trim() : "";
  const validLink = isHttpUrl(meetingUrl);

  input.value = validLink ? meetingUrl : "";
  input.placeholder = selectedClass
    ? "Esta turma ainda não possui um link de videoaula válido"
    : "Selecione uma turma para visualizar o link";
  link.hidden = !validLink;
  link.href = validLink ? meetingUrl : "#";
  button.disabled = !selectedClass || !validLink;
}

async function loadMakeupClasses() {
  const select = document.getElementById("slotClass");
  const previousValue = select.value;
  select.disabled = true;
  select.innerHTML = '<option value="">Carregando turmas...</option>';

  const response = await Auth.getClient().rpc("get_teacher_makeup_classes");
  if (response.error) throw response.error;
  makeupClasses = response.data || [];

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = makeupClasses.length ? "Selecione uma turma" : "Nenhuma turma ativa encontrada";
  select.appendChild(placeholder);

  makeupClasses.forEach(function (item) {
    const option = document.createElement("option");
    const count = Number(item.student_count || 0);
    const studentsLabel = count === 1 ? "1 aluno" : count + " alunos";
    option.value = String(item.class_number);
    option.textContent = (item.class_name || ("Turma " + item.class_number)) + " · " + studentsLabel +
      (isHttpUrl(item.video_lesson_url) ? "" : " · sem link de videoaula");
    select.appendChild(option);
  });

  if (makeupClasses.some(function (item) { return String(item.class_number) === previousValue; })) {
    select.value = previousValue;
  }
  select.disabled = makeupClasses.length === 0;
  updateClassLinkPreview();
}

function emailStatusLabel(status) {
  if (status === "sent") return "E-mail enviado";
  if (status === "failed") return "Falha no e-mail";
  return "E-mail pendente";
}

function renderBookingRow(booking) {
  const cancelled = booking.status === "cancelled";
  return '<div class="booking-row">' +
    '<div><p><strong>' + escapeHtml(booking.student_name) + '</strong> · ' + escapeHtml(booking.class_name) + '</p>' +
    '<p class="booking-email">' + escapeHtml(booking.student_email) + ' · ' + escapeHtml(emailStatusLabel(booking.email_status)) + '</p></div>' +
    (cancelled
      ? '<span class="status-pill danger">Reserva cancelada</span>'
      : '<button class="danger-button cancel-booking-button" type="button" data-booking-id="' + escapeHtml(booking.id) + '">CANCELAR RESERVA</button>') +
  '</div>';
}


function renderCapacitySummary(slot, occupancy, active) {
  const confirmed = Number(slot.confirmed_bookings || 0);
  if (!active) {
    return '<div class="card-meta"><span class="status-pill">' +
      confirmed + ' reposições confirmadas (histórico)</span></div>';
  }

  if (!occupancy) {
    return '<p class="error">Não foi possível calcular a lotação deste horário.</p>';
  }

  const regular = Number(occupancy.regular_students || 0);
  const holds = Number(occupancy.seat_holds || 0);
  const cancellations = Number(occupancy.cancelled_regular_students || 0);
  const replacements = Number(occupancy.confirmed_bookings || 0);
  const participants = Number(occupancy.expected_participants || 0);
  const capacity = Number(occupancy.operational_capacity || 0);
  const available = Number(occupancy.available_spots || 0);
  const excess = Number(occupancy.over_capacity || 0);
  const cancellationDetails = cancellations ? ' · ' + cancellations + ' cancelamentos registrados' : '';
  const holdDetails = holds ? ' · ' + holds + ' reservas de vaga' : '';
  const regularDetails = occupancy.is_regular_occurrence
    ? regular + ' alunos regulares' + cancellationDetails + holdDetails
    : 'Horário extraordinário (sem presença regular presumida)';

  return '<div class="card-meta"><span class="status-pill">' +
    available + (available === 1 ? ' vaga disponível' : ' vagas disponíveis') +
    '</span></div>' +
    '<p><strong>Ocupação prevista:</strong> ' + participants + ' de ' + capacity +
    ' lugares. ' + regularDetails + ' · ' + replacements +
    ' reposições confirmadas.</p>' +
    (excess > 0
      ? '<p class="error"><strong>Lotação excedida em ' + excess +
        ' participante(s).</strong> Verifique a reserva existente; não há novas vagas.</p>'
      : '');
}

function renderAdminSlot(slot, bookings, occupancy) {
  const isPast = new Date(slot.ends_at).getTime() < Date.now();
  const active = slot.is_active && !isPast;
  const statusLabel = !slot.is_active ? "Cancelado" : (isPast ? "Encerrado" : "Publicado");
  const statusClass = active ? "success" : (!slot.is_active ? "danger" : "");
  const slotBookings = bookings.filter(function (booking) { return booking.slot_id === slot.id; });
  const capacitySummary = renderCapacitySummary(slot, occupancy, active);

  return '<article class="slot-card' + (active ? '' : ' is-inactive') + '">' +
    '<div class="card-heading"><div><h3>' + escapeHtml(formatDate(slot.starts_at)) + '</h3>' +
    '<div class="card-time">' + escapeHtml(formatTime(slot.starts_at)) + ' às ' + escapeHtml(formatTime(slot.ends_at)) + '</div></div>' +
    '<span class="status-pill ' + statusClass + '">' + escapeHtml(statusLabel) + '</span></div>' +
    '<p><strong>Turma:</strong> ' + escapeHtml(slot.class_name || (slot.class_number ? ("Turma " + slot.class_number) : "Não definida")) + '</p>' +
    capacitySummary +
    (slot.notes ? '<p>' + escapeHtml(slot.notes) + '</p>' : '') +
    (isHttpUrl(slot.meeting_url) ? '<a class="link-button" href="' + escapeHtml(slot.meeting_url) + '" target="_blank" rel="noopener noreferrer">ABRIR LINK DA TURMA</a>' : '') +
    (active ? '<button class="danger-button cancel-slot-button" type="button" data-slot-id="' + escapeHtml(slot.id) + '">CANCELAR HORÁRIO</button>' : '') +
    '<div class="booking-list">' + (slotBookings.length ? slotBookings.map(renderBookingRow).join("") : '<p class="empty">Nenhum aluno reservou este horário.</p>') + '</div>' +
  '</article>';
}

async function loadAdminSchedule() {
  const container = document.getElementById("adminSlots");
  container.innerHTML = '<p class="empty">Carregando horários...</p>';
  const client = Auth.getClient();
  const results = await Promise.all([
    client.rpc("get_teacher_makeup_slots"),
    client.rpc("get_teacher_makeup_bookings"),
    client.rpc("get_teacher_makeup_slot_occupancy")
  ]);
  if (results[0].error) throw results[0].error;
  if (results[1].error) throw results[1].error;
  if (results[2].error) throw results[2].error;

  const slots = results[0].data || [];
  const bookings = results[1].data || [];
  const occupancyBySlot = new Map((results[2].data || []).map(function (item) {
    return [String(item.slot_id), item];
  }));
  container.innerHTML = slots.length
    ? slots.map(function (slot) {
      return renderAdminSlot(slot, bookings, occupancyBySlot.get(String(slot.id)));
    }).join("")
    : '<p class="empty">Nenhum horário de reposição foi publicado.</p>';

  document.querySelectorAll(".cancel-slot-button").forEach(function (button) {
    button.addEventListener("click", function () { cancelSlot(button.dataset.slotId, button); });
  });
  document.querySelectorAll(".cancel-booking-button").forEach(function (button) {
    button.addEventListener("click", function () { cancelBooking(button.dataset.bookingId, button); });
  });
}

async function cancelSlot(slotId, button) {
  if (!window.confirm("Cancelar este horário e todas as reservas confirmadas nele?")) return;
  button.disabled = true;
  try {
    const response = await Auth.getClient().rpc("cancel_makeup_class_slot", { target_slot_id: slotId });
    if (response.error) throw response.error;
    document.getElementById("adminStatus").textContent = "Horário cancelado.";
    await loadAdminSchedule();
  } catch (error) {
    document.getElementById("adminStatus").textContent = "Não foi possível cancelar: " + (error.message || "tente novamente.");
    button.disabled = false;
  }
}

async function cancelBooking(bookingId, button) {
  if (!window.confirm("Cancelar a reserva deste aluno e liberar a vaga?")) return;
  button.disabled = true;
  try {
    const response = await Auth.getClient().rpc("cancel_makeup_class_booking", { target_booking_id: bookingId });
    if (response.error) throw response.error;
    document.getElementById("adminStatus").textContent = "Reserva cancelada e vaga liberada.";
    await loadAdminSchedule();
  } catch (error) {
    document.getElementById("adminStatus").textContent = "Não foi possível cancelar a reserva: " + (error.message || "tente novamente.");
    button.disabled = false;
  }
}

function setInitialFormValues() {
  const now = new Date();
  const saoPauloDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo"
  }).format(now);
  document.getElementById("slotDate").min = saoPauloDate;
  if (!document.getElementById("slotDate").value) document.getElementById("slotDate").value = saoPauloDate;
  if (!document.getElementById("slotStartTime").value) document.getElementById("slotStartTime").value = "14:00";
}

document.getElementById("slotForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = document.getElementById("createSlotButton");
  const message = document.getElementById("formMessage");
  const startTime = document.getElementById("slotStartTime").value;
  const endTime = calculateOneHourEndTime(startTime);
  const selectedClass = getSelectedClass();
  if (!selectedClass) {
    message.className = "form-message error";
    message.textContent = "Escolha a turma deste horário.";
    return;
  }
  if (!isHttpUrl(selectedClass.video_lesson_url)) {
    message.className = "form-message error";
    message.textContent = "Cadastre um link de videoaula válido para esta turma antes de publicar o horário.";
    return;
  }
  if (!endTime) {
    message.className = "form-message error";
    message.textContent = "Escolha um horário de início até 22:59 para que a aula termine no mesmo dia.";
    return;
  }

  button.disabled = true;
  button.textContent = "PUBLICANDO...";
  message.className = "form-message";
  message.textContent = "";

  try {
    const response = await Auth.getClient().rpc("create_makeup_class_slot", {
      target_class_number: Number(selectedClass.class_number),
      target_date: document.getElementById("slotDate").value,
      target_start_time: startTime,
      target_end_time: endTime,
      target_capacity: Number(document.getElementById("slotCapacity").value),
      target_notes: document.getElementById("slotNotes").value.trim() || null
    });
    if (response.error) throw response.error;
    message.className = "form-message success";
    message.textContent = "Horário publicado para os alunos.";
    document.getElementById("slotNotes").value = "";
    await loadAdminSchedule();
  } catch (error) {
    message.className = "form-message error";
    message.textContent = error.message || "Não foi possível publicar o horário.";
  } finally {
    button.textContent = "PUBLICAR HORÁRIO";
    updateClassLinkPreview();
  }
});

document.getElementById("slotClass").addEventListener("change", function () {
  updateClassLinkPreview();
  const selectedClass = getSelectedClass();
  const message = document.getElementById("formMessage");
  if (selectedClass && !isHttpUrl(selectedClass.video_lesson_url)) {
    message.className = "form-message error";
    message.textContent = "Esta turma ainda não possui um link de videoaula válido.";
  } else {
    message.className = "form-message";
    message.textContent = "";
  }
});

document.getElementById("refreshAdminButton").addEventListener("click", function () {
  Promise.all([loadMakeupClasses(), loadAdminSchedule()]).catch(function (error) {
    document.getElementById("adminStatus").textContent = "Não foi possível atualizar: " + (error.message || "tente novamente.");
  });
});

async function guardAdminPage() {
  const status = document.getElementById("adminStatus");
  const ready = await waitForAuthResources();
  if (!ready) {
    status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache.";
    document.body.classList.remove("auth-checking");
    return;
  }

  currentAdminSession = await Auth.getSession();
  if (!currentAdminSession || !currentAdminSession.user) {
    redirectToLogin();
    return;
  }

  const adminResponse = await Auth.getClient().rpc("is_teacher_admin");
  if (adminResponse.error || adminResponse.data !== true) {
    status.textContent = "Acesso negado. Esta página é exclusiva do administrador.";
    document.getElementById("slotForm").hidden = true;
    document.getElementById("adminSlots").innerHTML = '<p class="error">Você não tem permissão para visualizar esta agenda.</p>';
    document.body.classList.remove("auth-checking");
    return;
  }

  status.textContent = "Professor autenticado: " + currentAdminSession.user.email + ".";
  document.body.classList.remove("auth-checking");
  setInitialFormValues();

  try {
    await Promise.all([loadMakeupClasses(), loadAdminSchedule()]);
  } catch (error) {
    document.getElementById("adminSlots").innerHTML = '<p class="error">' + escapeHtml(error.message || "Não foi possível carregar a agenda.") + '</p>';
  }
}

guardAdminPage();

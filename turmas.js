let currentProfessorSession = null;
let currentClasses = [];

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("turmas.html");
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
  return String(value || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;");
}

function getClassDisplayName(classItem) {
  return String(classItem.class_name || ("Turma " + classItem.class_number));
}

function getClassTypeMeta(value) {
  if (value === "quartet") return { label:"GRUPO", css:"quartet" };
  if (value === "quintet") return { label:"QUINTETO", css:"quintet" };
  if (value === "eight_students") return { label:"8 ALUNOS", css:"eight-students" };
  if (value === "individual") return { label:"INDIVIDUAL", css:"individual" };
  return { label:"TIPO NÃO DEFINIDO", css:"unset" };
}

function weekdayLabel(value) {
  return ({1:"Segunda-feira",2:"Terça-feira",3:"Quarta-feira",4:"Quinta-feira",5:"Sexta-feira",6:"Sábado",7:"Domingo"})[Number(value)] || "Não definido";
}

function timeLabel(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return "Não definido";
  const h = Number(match[1]);
  const m = Number(match[2]);
  return m === 0 ? h + "h" : h + "h" + String(m).padStart(2,"0");
}

function sortClassesAlphabetically(classes) {
  return classes.slice().sort(function (a,b) {
    return getClassDisplayName(a).localeCompare(getClassDisplayName(b), "pt-BR", { sensitivity:"base", numeric:true });
  });
}

async function loadClasses() {
  const client = Auth.getClient();
  const results = await Promise.all([
    client.rpc("get_teacher_classes_with_type"),
    client.from("teacher_classes").select("class_number,class_weekday,class_start_time").eq("is_active", true)
  ]);
  results.forEach(function (result) { if (result.error) throw result.error; });
  const scheduleMap = new Map((results[1].data || []).map(function (row) { return [Number(row.class_number), row]; }));
  return sortClassesAlphabetically((results[0].data || []).map(function (row) {
    const schedule = scheduleMap.get(Number(row.class_number)) || {};
    return Object.assign({}, row, schedule);
  }));
}

function weekdayOptions(selected) {
  return '<option value=""' + (!selected ? ' selected' : '') + '>Não definido</option>' +
    [[1,"Segunda-feira"],[2,"Terça-feira"],[3,"Quarta-feira"],[4,"Quinta-feira"],[5,"Sexta-feira"],[6,"Sábado"],[7,"Domingo"]].map(function (item) {
      return '<option value="' + item[0] + '"' + (Number(selected) === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
    }).join("");
}

function renderClassCard(classItem) {
  const classNumber = classItem.class_number;
  const className = classItem.class_name || ("Turma " + classNumber);
  const studentCount = Number(classItem.student_count || 0);
  const typeMeta = getClassTypeMeta(classItem.class_type);
  const timeValue = classItem.class_start_time ? String(classItem.class_start_time).slice(0,5) : "";
  const scheduleText = classItem.class_weekday && classItem.class_start_time ? weekdayLabel(classItem.class_weekday) + ", " + timeLabel(classItem.class_start_time) : "Horário semanal não definido";

  return '<div class="class-card" data-class-number="' + escapeHtml(classNumber) + '">' +
    '<div class="class-card-title"><span><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-6h6v6"/></svg></span>' + escapeHtml(className) + '</span><span class="class-type-badge ' + typeMeta.css + '">' + typeMeta.label + '</span></div>' +
    '<p class="class-meta">Alunos inscritos: ' + studentCount + ' · ' + escapeHtml(scheduleText) + '</p>' +
    '<div class="config-editor">' +
      '<label class="full">Nome da turma<input class="class-config-time" data-class-name-input="' + escapeHtml(classNumber) + '" type="text" value="' + escapeHtml(className) + '" maxlength="120"></label>' +
      '<label>Etiqueta da turma<select class="class-config-select" data-class-type-select="' + escapeHtml(classNumber) + '"><option value=""' + (!classItem.class_type ? ' selected' : '') + '>Selecione</option><option value="quartet"' + (classItem.class_type === 'quartet' ? ' selected' : '') + '>QUARTETO</option><option value="quintet"' + (classItem.class_type === 'quintet' ? ' selected' : '') + '>QUINTETO</option><option value="eight_students"' + (classItem.class_type === 'eight_students' ? ' selected' : '') + '>8 ALUNOS</option><option value="individual"' + (classItem.class_type === 'individual' ? ' selected' : '') + '>INDIVIDUAL</option></select></label>' +
      '<label>Dia semanal<select class="class-config-select" data-class-weekday-select="' + escapeHtml(classNumber) + '">' + weekdayOptions(classItem.class_weekday) + '</select></label>' +
      '<label>Horário<input class="class-config-time" data-class-time-input="' + escapeHtml(classNumber) + '" type="time" value="' + escapeHtml(timeValue) + '"></label>' +
      '<div class="schedule-help">Você pode alterar o nome, o tipo, o dia e o horário sem recriar a turma. O horário é usado em MINHA SEMANA para mostrar a próxima aula.</div>' +
      '<button class="config-save-button full" type="button" data-save-class-config="' + escapeHtml(classNumber) + '">SALVAR CONFIGURAÇÃO</button>' +
    '</div>' +
    '<div class="class-actions"><a class="open-class-button" href="turma.html?id=' + encodeURIComponent(classNumber) + '">ABRIR TURMA</a><button class="remove-class-button" type="button" data-class-number="' + escapeHtml(classNumber) + '" data-class-name="' + escapeHtml(className) + '">EXCLUIR TURMA</button></div>' +
  '</div>';
}

function renderClassesFromState() {
  const grid = document.getElementById("classesGrid");
  if (!currentClasses.length) {
    grid.className = "empty";
    grid.textContent = "Nenhuma turma criada ainda.";
    return;
  }
  grid.className = "menu-grid";
  grid.innerHTML = currentClasses.map(renderClassCard).join("");
  attachClassButtons();
}

async function renderClasses() {
  const grid = document.getElementById("classesGrid");
  try {
    currentClasses = await loadClasses();
    renderClassesFromState();
  } catch (error) {
    grid.className = "error";
    grid.textContent = "Não foi possível carregar as turmas: " + (error.message || "erro desconhecido") + ".";
  }
}

async function createClass(event) {
  event.preventDefault();
  const message = document.getElementById("classMessage");
  const nameInput = document.getElementById("className");
  const typeSelect = document.getElementById("classType");
  const weekdaySelect = document.getElementById("classWeekday");
  const timeInput = document.getElementById("classStartTime");
  const className = nameInput.value.trim();
  const classType = typeSelect.value;
  const weekday = weekdaySelect.value ? Number(weekdaySelect.value) : null;
  const startTime = timeInput.value || null;

  if (!classType) {
    message.className = "error";
    message.textContent = "Selecione se a turma é INDIVIDUAL, QUARTETO, QUINTETO ou 8 ALUNOS.";
    return;
  }
  if ((weekday && !startTime) || (!weekday && startTime)) {
    message.className = "error";
    message.textContent = "Para definir o horário semanal, informe o dia e o horário juntos.";
    return;
  }

  message.className = "empty";
  message.textContent = "Criando turma...";

  try {
    const client = Auth.getClient();
    const response = await client.rpc("create_teacher_class_with_type", { target_class_name:className || null, target_class_type:classType });
    if (response.error) throw response.error;
    const classNumber = response.data && response.data.class_number ? Number(response.data.class_number) : null;
    if (classNumber && weekday && startTime) {
      const update = await client.from("teacher_classes").update({ class_weekday:weekday, class_start_time:startTime, updated_at:new Date().toISOString() }).eq("class_number", classNumber);
      if (update.error) throw update.error;
    }
    nameInput.value = "";
    typeSelect.value = "";
    weekdaySelect.value = "";
    timeInput.value = "";
    message.className = "empty";
    message.textContent = "Turma criada.";
    await renderClasses();
  } catch (error) {
    message.className = "error";
    message.textContent = "Não foi possível criar a turma: " + (error.message || "erro desconhecido") + ".";
  }
}

async function saveClassConfig(classNumber, button) {
  const nameInput = document.querySelector('[data-class-name-input="' + CSS.escape(String(classNumber)) + '"]');
  const typeSelect = document.querySelector('[data-class-type-select="' + CSS.escape(String(classNumber)) + '"]');
  const weekdaySelect = document.querySelector('[data-class-weekday-select="' + CSS.escape(String(classNumber)) + '"]');
  const timeInput = document.querySelector('[data-class-time-input="' + CSS.escape(String(classNumber)) + '"]');
  const className = nameInput ? nameInput.value.trim() : "";
  const classType = typeSelect ? typeSelect.value : "";
  const weekday = weekdaySelect && weekdaySelect.value ? Number(weekdaySelect.value) : null;
  const startTime = timeInput && timeInput.value ? timeInput.value : null;

  if (!className) { alert("Digite um nome para a turma."); return; }
  if (!classType) { alert("Selecione INDIVIDUAL, QUARTETO, QUINTETO ou 8 ALUNOS antes de salvar."); return; }
  if ((weekday && !startTime) || (!weekday && startTime)) { alert("Informe o dia e o horário juntos, ou deixe ambos vazios."); return; }

  button.disabled = true;
  button.textContent = "SALVANDO...";
  try {
    const client = Auth.getClient();
    const typeResponse = await client.rpc("set_teacher_class_type", { target_class_number:Number(classNumber), target_class_type:classType });
    if (typeResponse.error) throw typeResponse.error;
    const updateResponse = await client.from("teacher_classes").update({
      class_name: className,
      class_weekday: weekday,
      class_start_time: startTime,
      updated_at: new Date().toISOString()
    }).eq("class_number", Number(classNumber));
    if (updateResponse.error) throw updateResponse.error;
    await renderClasses();
  } catch (error) {
    alert("Não foi possível salvar a configuração: " + (error.message || "erro desconhecido") + ".");
    button.disabled = false;
    button.textContent = "SALVAR CONFIGURAÇÃO";
  }
}

async function deleteClass(classNumber, className, button) {
  const confirmed = window.confirm("Excluir " + className + "? Isso remove os alunos da turma e os links cadastrados para ela. Os registros de frequência já salvos permanecem no histórico geral dos alunos.");
  if (!confirmed) return;
  button.disabled = true;
  button.textContent = "EXCLUINDO...";
  try {
    const response = await Auth.getClient().rpc("delete_teacher_class", { target_class_number:Number(classNumber) });
    if (response.error) throw response.error;
    await renderClasses();
  } catch (error) {
    alert("Não foi possível excluir a turma: " + (error.message || "erro desconhecido") + ".");
    button.disabled = false;
    button.textContent = "EXCLUIR TURMA";
  }
}

function attachClassButtons() {
  document.querySelectorAll(".remove-class-button").forEach(function (button) {
    button.addEventListener("click", function () { deleteClass(button.dataset.classNumber, button.dataset.className, button); });
  });
  document.querySelectorAll("[data-save-class-config]").forEach(function (button) {
    button.addEventListener("click", function () { saveClassConfig(button.dataset.saveClassConfig, button); });
  });
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
  await renderClasses();
}

const createClassForm = document.getElementById("createClassForm");
if (createClassForm) createClassForm.addEventListener("submit", createClass);
guardPage();

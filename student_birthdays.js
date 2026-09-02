(function () {
  "use strict";

  if (window.__teacherFlaviusStudentBirthdaysLoaded) return;
  window.__teacherFlaviusStudentBirthdaysLoaded = true;

  const AUTH_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 30,
    delayMs: 100
  });

  function authResourcesAreReady() {
    return !!(window.Auth && Auth.getClient && Auth.getSession);
  }

  async function waitForAuth() {
    if (!window.ResourceWaiter) return false;
    return window.ResourceWaiter.waitUntil(authResourcesAreReady, AUTH_WAIT_OPTIONS);
  }

  function isLoginOrOnboardingPage() {
    const path = window.location.pathname || "/";
    return path === "/login/" || path.endsWith("/login.html") ||
      path === "/complete-cadastro/" || path.endsWith("/complete-cadastro.html");
  }

  function isProfessorHomePage() {
    const path = window.location.pathname || "/";
    return path === "/professor/" || path.endsWith("/professor.html");
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function maskBirthDate(value) {
    const digits = onlyDigits(value).slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return digits.slice(0, 2) + "/" + digits.slice(2);
    return digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
  }

  function parseBirthDate(value) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || "").trim());
    if (!match) throw new Error("Informe a data no formato DD/MM/AAAA.");

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (year < 1900) throw new Error("Informe uma data de nascimento válida.");

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) throw new Error("Informe uma data de nascimento válida.");

    const now = new Date();
    const todayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    const todayMap = {};
    todayParts.forEach(function (part) { todayMap[part.type] = part.value; });
    const todayIso = todayMap.year + "-" + todayMap.month + "-" + todayMap.day;
    const iso = match[3] + "-" + match[2] + "-" + match[1];
    if (iso > todayIso) throw new Error("A data de nascimento não pode estar no futuro.");

    return iso;
  }

  function installStyles() {
    if (document.getElementById("teacher-student-birthday-styles")) return;
    const style = document.createElement("style");
    style.id = "teacher-student-birthday-styles";
    style.textContent = [
      ".tf-birthday-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(2,6,23,.86);backdrop-filter:blur(8px)}",
      ".tf-birthday-modal{width:min(100%,480px);padding:30px 26px;border:1px solid rgba(129,140,248,.4);border-radius:20px;background:linear-gradient(145deg,#111827,#1e1b4b);box-shadow:0 28px 80px rgba(0,0,0,.48);font-family:Georgia,serif;text-align:center;color:#f8fafc}",
      ".tf-birthday-badge{display:inline-block;margin-bottom:16px;padding:5px 13px;border-radius:999px;background:linear-gradient(90deg,#818cf8,#a78bfa);font:700 11px monospace;letter-spacing:2px;color:#fff}",
      ".tf-birthday-modal h2{margin:0 0 12px;font-size:22px;line-height:1.4;color:#f8fafc}",
      ".tf-birthday-modal p{margin:0 0 18px;color:#cbd5e1;font-size:14px;line-height:1.6}",
      ".tf-birthday-input{width:100%;padding:13px 14px;border:1.5px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(255,255,255,.07);color:#f8fafc;font:16px Georgia,serif;text-align:center;letter-spacing:.04em;outline:none}",
      ".tf-birthday-input:focus{border-color:#818cf8}",
      ".tf-birthday-button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#818cf8,#a78bfa);color:#fff;font:700 15px Georgia,serif;cursor:pointer}",
      ".tf-birthday-button:disabled{opacity:.65;cursor:wait}",
      ".tf-birthday-error{min-height:18px;margin-top:10px;color:#fca5a5;font-size:13px;line-height:1.45}",
      ".tf-birthday-list{margin:4px 0 20px;padding:0;list-style:none;color:#f8fafc;font-size:17px;line-height:1.65}",
      ".tf-birthday-close{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18)}",
      "@media(max-width:520px){.tf-birthday-modal{padding:25px 20px}.tf-birthday-modal h2{font-size:20px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function lockPage() {
    document.documentElement.dataset.tfBirthdayPreviousOverflow = document.documentElement.style.overflow || "";
    document.documentElement.style.overflow = "hidden";
  }

  function unlockPage() {
    const previous = document.documentElement.dataset.tfBirthdayPreviousOverflow || "";
    document.documentElement.style.overflow = previous;
    delete document.documentElement.dataset.tfBirthdayPreviousOverflow;
  }

  function showStudentBirthDatePrompt(session, client) {
    if (!document.body || document.getElementById("teacherStudentBirthDatePrompt")) return;
    installStyles();

    const overlay = document.createElement("div");
    overlay.id = "teacherStudentBirthDatePrompt";
    overlay.className = "tf-birthday-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "teacherStudentBirthDateTitle");
    overlay.innerHTML = [
      '<div class="tf-birthday-modal">',
      '<div class="tf-birthday-badge">TEACHER FLÁVIO</div>',
      '<h2 id="teacherStudentBirthDateTitle">Complete seus dados de matrícula</h2>',
      '<p>Informe sua data de nascimento no formato <strong>DD/MM/AAAA</strong>.</p>',
      '<input id="teacherStudentBirthDateInput" class="tf-birthday-input" type="text" inputmode="numeric" autocomplete="bday" maxlength="10" placeholder="DD/MM/AAAA" aria-label="Data de nascimento" />',
      '<button id="teacherStudentBirthDateSave" class="tf-birthday-button" type="button">SALVAR DATA DE NASCIMENTO</button>',
      '<div id="teacherStudentBirthDateError" class="tf-birthday-error" role="alert"></div>',
      '</div>'
    ].join("");
    document.body.appendChild(overlay);
    lockPage();

    const input = document.getElementById("teacherStudentBirthDateInput");
    const button = document.getElementById("teacherStudentBirthDateSave");
    const errorBox = document.getElementById("teacherStudentBirthDateError");

    input.addEventListener("input", function () { input.value = maskBirthDate(input.value); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        button.click();
      }
    });

    button.addEventListener("click", async function () {
      errorBox.textContent = "";
      button.disabled = true;
      button.textContent = "SALVANDO...";
      try {
        const iso = parseBirthDate(input.value);
        const response = await client
          .from("profiles")
          .update({ date_of_birth: iso })
          .eq("id", session.user.id)
          .select("date_of_birth")
          .single();
        if (response.error) throw response.error;
        overlay.remove();
        unlockPage();
      } catch (error) {
        errorBox.textContent = error.message || "Não foi possível salvar a data de nascimento.";
        button.disabled = false;
        button.textContent = "SALVAR DATA DE NASCIMENTO";
      }
    });

    window.setTimeout(function () { input.focus(); }, 50);
  }

  async function maybeCollectStudentBirthDate(session, client, isAdmin) {
    if (isAdmin || isLoginOrOnboardingPage()) return;

    const profileResponse = await client
      .from("profiles")
      .select("enrolled,profile_completed,date_of_birth")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profileResponse.error || !profileResponse.data) return;
    const profile = profileResponse.data;
    if (profile.enrolled !== true || profile.profile_completed !== true || profile.date_of_birth) return;
    showStudentBirthDatePrompt(session, client);
  }

  function saoPauloMonthDay() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(function (part) { map[part.type] = part.value; });
    return map.month + "-" + map.day;
  }

  function showProfessorBirthdayAlert(students) {
    if (!document.body || !students.length || document.getElementById("teacherProfessorBirthdayAlert")) return;
    installStyles();

    const overlay = document.createElement("div");
    overlay.id = "teacherProfessorBirthdayAlert";
    overlay.className = "tf-birthday-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "teacherProfessorBirthdayTitle");

    const names = students.map(function (student) {
      const item = document.createElement("li");
      item.textContent = student.name || student.email || "Aluno";
      return item.outerHTML;
    }).join("");

    overlay.innerHTML = [
      '<div class="tf-birthday-modal">',
      '<div class="tf-birthday-badge">🎂 ANIVERSÁRIO</div>',
      '<h2 id="teacherProfessorBirthdayTitle">' + (students.length === 1 ? "Tem um aluno fazendo aniversário hoje!" : "Há alunos fazendo aniversário hoje!") + '</h2>',
      '<ul class="tf-birthday-list">' + names + '</ul>',
      '<button id="teacherProfessorBirthdayClose" class="tf-birthday-button tf-birthday-close" type="button">FECHAR</button>',
      '</div>'
    ].join("");

    document.body.appendChild(overlay);
    lockPage();
    document.getElementById("teacherProfessorBirthdayClose").addEventListener("click", function () {
      overlay.remove();
      unlockPage();
    });
  }

  async function maybeShowProfessorBirthdayAlert(client, isAdmin) {
    if (!isAdmin || !isProfessorHomePage()) return;

    const response = await client
      .from("profiles")
      .select("name,email,date_of_birth")
      .eq("enrolled", true)
      .eq("archived", false)
      .not("date_of_birth", "is", null)
      .order("name", { ascending: true });

    if (response.error) {
      console.warn("Não foi possível verificar aniversariantes:", response.error.message);
      return;
    }

    const today = saoPauloMonthDay();
    const birthdayStudents = (response.data || []).filter(function (student) {
      const value = String(student.date_of_birth || "");
      return value.length >= 10 && value.slice(5, 10) === today;
    });

    if (birthdayStudents.length) showProfessorBirthdayAlert(birthdayStudents);
  }

  async function initialize() {
    if (!(await waitForAuth())) return;
    const session = await Auth.getSession();
    const client = Auth.getClient();
    if (!session || !session.user || !client) return;

    let isAdmin = false;
    try {
      const adminResponse = await client.rpc("is_teacher_admin");
      isAdmin = !adminResponse.error && adminResponse.data === true;
    } catch (_) {}

    try { await maybeCollectStudentBirthDate(session, client, isAdmin); }
    catch (error) { console.warn("Não foi possível verificar a data de nascimento do aluno:", error && error.message ? error.message : error); }

    try { await maybeShowProfessorBirthdayAlert(client, isAdmin); }
    catch (error) { console.warn("Não foi possível verificar aniversariantes:", error && error.message ? error.message : error); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

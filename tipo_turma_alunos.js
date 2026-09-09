(function () {
  "use strict";

  const CLASS_TYPES = ["INDIVIDUAL", "QUARTETO", "8 ALUNOS"];
  const AUTH_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 20,
    delayMs: 150,
    finalCheck: false
  });
  const RESOURCE_WAITER_MODULE = Object.freeze({
    globalName: "ResourceWaiter",
    selector: 'script[src*="resource_waiter.js"]',
    src: "/resource_waiter.js?v=20260909-1"
  });

  const classTypeByStudentId = new Map();
  let client = null;

  function authResourcesAreReady() {
    return !!(window.Auth && Auth.isConfigured && Auth.isConfigured());
  }

  async function getResourceWaiter() {
    if (window.ResourceWaiter) return window.ResourceWaiter;
    if (!window.ModuleLoader || typeof window.ModuleLoader.loadGlobalModule !== "function") return null;

    try {
      return await window.ModuleLoader.loadGlobalModule(RESOURCE_WAITER_MODULE);
    } catch (error) {
      console.error("Falha ao carregar ResourceWaiter:", error);
      return null;
    }
  }

  async function waitForAuth() {
    const resourceWaiter = await getResourceWaiter();
    if (!resourceWaiter || typeof resourceWaiter.waitUntil !== "function") return false;
    return resourceWaiter.waitUntil(authResourcesAreReady, AUTH_WAIT_OPTIONS);
  }

  function getStudentId(card) {
    const deleteButton = card.querySelector(".delete-student-button[data-user-id]");
    if (deleteButton && deleteButton.dataset.userId) return deleteButton.dataset.userId;

    const editLink = Array.from(card.querySelectorAll("a[href*='editar_aluno.html?id=']"))[0];
    if (!editLink) return "";

    try {
      const url = new URL(editLink.href, window.location.origin);
      return url.searchParams.get("id") || "";
    } catch (error) {
      return "";
    }
  }

  function createControl(card, studentId) {
    if (!studentId || card.querySelector(".student-class-type-control")) return;

    const actions = card.querySelector(".student-actions");
    if (!actions) return;

    const wrapper = document.createElement("div");
    wrapper.className = "student-class-type-control";
    wrapper.style.marginTop = "14px";
    wrapper.style.paddingTop = "14px";
    wrapper.style.borderTop = "1px solid rgba(255,255,255,0.08)";

    const label = document.createElement("label");
    label.style.display = "block";
    label.style.marginBottom = "7px";
    label.style.fontWeight = "700";
    label.textContent = "TIPO DE TURMA";

    const select = document.createElement("select");
    select.className = "student-class-type-select";
    select.dataset.studentId = studentId;
    select.style.width = "100%";
    select.style.boxSizing = "border-box";
    select.style.padding = "11px 12px";
    select.style.borderRadius = "10px";
    select.style.border = "1px solid rgba(129,140,248,0.45)";
    select.style.background = "rgba(15,23,42,0.88)";
    select.style.color = "#f8fafc";
    select.style.fontFamily = "inherit";
    select.style.fontSize = "14px";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Não classificado";
    select.appendChild(emptyOption);

    CLASS_TYPES.forEach(function (type) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      select.appendChild(option);
    });

    select.value = classTypeByStudentId.get(studentId) || "";

    const status = document.createElement("span");
    status.style.display = "block";
    status.style.minHeight = "18px";
    status.style.marginTop = "6px";
    status.style.fontSize = "12px";
    status.style.color = "#94a3b8";

    select.addEventListener("change", async function () {
      const previousValue = classTypeByStudentId.get(studentId) || "";
      const nextValue = select.value || null;
      select.disabled = true;
      status.textContent = "Salvando...";

      try {
        const response = await client
          .from("profiles")
          .update({ class_type: nextValue })
          .eq("id", studentId)
          .select("id, class_type")
          .single();

        if (response.error) throw response.error;

        classTypeByStudentId.set(studentId, response.data && response.data.class_type ? response.data.class_type : "");
        status.textContent = "Classificação salva.";
        setTimeout(function () {
          if (status.textContent === "Classificação salva.") status.textContent = "";
        }, 1800);
      } catch (error) {
        select.value = previousValue;
        status.textContent = "Não foi possível salvar.";
        console.error("Erro ao salvar tipo de turma:", error);
        alert("Não foi possível salvar o tipo de turma deste aluno: " + (error.message || "erro desconhecido"));
      } finally {
        select.disabled = false;
      }
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    wrapper.appendChild(status);
    card.insertBefore(wrapper, actions);
  }

  function enhanceVisibleCards() {
    document.querySelectorAll("#studentProfilesList .student-card").forEach(function (card) {
      createControl(card, getStudentId(card));
    });
  }

  async function loadClassTypes() {
    const response = await client
      .from("profiles")
      .select("id, class_type");

    if (response.error) throw response.error;

    (response.data || []).forEach(function (row) {
      classTypeByStudentId.set(String(row.id), row.class_type || "");
    });
  }

  async function init() {
    const authReady = await waitForAuth();
    if (!authReady) return;

    client = Auth.getClient();

    try {
      await loadClassTypes();
    } catch (error) {
      console.error("Não foi possível carregar os tipos de turma:", error);
      return;
    }

    enhanceVisibleCards();

    const list = document.getElementById("studentProfilesList");
    if (!list) return;

    const observer = new MutationObserver(function () {
      enhanceVisibleCards();
    });

    observer.observe(list, { childList: true, subtree: true });
  }

  init();
})();

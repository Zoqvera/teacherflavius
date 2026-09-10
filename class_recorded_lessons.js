(function () {
  var AUTH_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 20,
    delayMs: 150
  });
  var RESOURCE_WAITER_MODULE = Object.freeze({
    globalName: "ResourceWaiter",
    selector: 'script[src*="resource_waiter.js"]',
    src: "/resource_waiter.js?v=20260909-1"
  });

  function authResourcesAreReady() {
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured && Auth.isConfigured());
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

  async function waitForAuthResources() {
    var resourceWaiter = await getResourceWaiter();
    if (!resourceWaiter || typeof resourceWaiter.waitUntil !== "function") return false;
    return resourceWaiter.waitUntil(authResourcesAreReady, AUTH_WAIT_OPTIONS);
  }

  function getClassNumber() {
    var params = new URLSearchParams(window.location.search);
    var value = Number(params.get("id"));
    if (!Number.isInteger(value) || value < 1) return null;
    return value;
  }

  function injectRecordedLessonsField() {
    var lessonMaterialInput = document.getElementById("lessonMaterialUrl");
    var whatsappInput = document.getElementById("whatsappGroupUrl");
    if (!lessonMaterialInput || !whatsappInput || document.getElementById("recordedLessonsUrl")) return;

    var label = document.createElement("label");
    label.className = "class-resource-label";
    label.setAttribute("for", "recordedLessonsUrl");
    label.textContent = "Link das aulas gravadas";

    var input = document.createElement("input");
    input.id = "recordedLessonsUrl";
    input.type = "url";
    input.placeholder = "https://...";
    input.style.width = "100%";
    input.style.background = "rgba(255,255,255,0.06)";
    input.style.border = "1.5px solid rgba(255,255,255,0.12)";
    input.style.borderRadius = "12px";
    input.style.padding = "12px 13px";
    input.style.color = "#f1f5f9";
    input.style.fontSize = "14px";
    input.style.fontFamily = "Georgia, serif";
    input.style.marginTop = "8px";

    var whatsappLabel = document.querySelector('label[for="whatsappGroupUrl"]');
    if (whatsappLabel && whatsappLabel.parentNode) {
      whatsappLabel.parentNode.insertBefore(label, whatsappLabel);
      whatsappLabel.parentNode.insertBefore(input, whatsappLabel);
    }
  }

  async function loadRecordedLessonsUrl() {
    var classNumber = getClassNumber();
    var input = document.getElementById("recordedLessonsUrl");
    if (!classNumber || !input) return;

    var ready = await waitForAuthResources();
    if (!ready) return;

    try {
      var client = Auth.getClient();
      var response = await client.rpc("get_teacher_class_resources", { target_class_number: classNumber });
      if (response.error) throw response.error;
      var row = response.data && response.data.length ? response.data[0] : null;
      input.value = row && row.recorded_lessons_url ? row.recorded_lessons_url : "";
    } catch (error) {
      console.warn("Não foi possível carregar link das aulas gravadas:", error.message || error);
    }
  }

  async function saveClassResourcesWithRecordedLessons(event) {
    var form = document.getElementById("classResourcesForm");
    if (!form || event.target !== form) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    var message = document.getElementById("classResourcesMessage");
    var classNumber = getClassNumber();
    if (message) {
      message.className = "empty";
      message.textContent = "Salvando links...";
    }

    try {
      var ready = await waitForAuthResources();
      if (!ready) throw new Error("Supabase não configurado.");
      var client = Auth.getClient();
      var response = await client.rpc("save_teacher_class_resources", {
        target_class_number: classNumber,
        target_video_lesson_url: (document.getElementById("videoLessonUrl") || {}).value ? document.getElementById("videoLessonUrl").value.trim() : "",
        target_lesson_material_url: (document.getElementById("lessonMaterialUrl") || {}).value ? document.getElementById("lessonMaterialUrl").value.trim() : "",
        target_recorded_lessons_url: (document.getElementById("recordedLessonsUrl") || {}).value ? document.getElementById("recordedLessonsUrl").value.trim() : "",
        target_whatsapp_group_url: (document.getElementById("whatsappGroupUrl") || {}).value ? document.getElementById("whatsappGroupUrl").value.trim() : ""
      });
      if (response.error) throw response.error;
      if (message) {
        message.className = "empty";
        message.textContent = "Links da turma salvos.";
      }
    } catch (error) {
      if (message) {
        message.className = "error";
        message.textContent = "Não foi possível salvar os links: " + (error.message || "erro desconhecido") + ". Execute supabase_aulas_gravadas.sql no Supabase.";
      }
    }
  }

  function initTeacherClassPage() {
    if (!document.getElementById("classResourcesForm")) return;
    injectRecordedLessonsField();
    document.addEventListener("submit", saveClassResourcesWithRecordedLessons, true);
    setTimeout(loadRecordedLessonsUrl, 300);
    setTimeout(loadRecordedLessonsUrl, 1000);
  }

  function init() {
    initTeacherClassPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

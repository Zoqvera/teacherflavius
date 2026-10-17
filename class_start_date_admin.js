(function () {
  "use strict";

  function getClassNumber() {
    const value = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function setMessage(message, isError) {
    const status = document.getElementById("classStartDateMessage");
    if (!status) return;
    status.className = isError ? "error" : "empty";
    status.textContent = message;
  }

  async function callTeacherFunction(name, parameters) {
    if (!window.Auth || !Auth.isConfigured()) {
      throw new Error("Autenticação indisponível.");
    }

    const response = await Auth.getClient().rpc(name, parameters);
    if (response.error) throw response.error;
    return response.data;
  }

  async function loadClassStartDate(classNumber) {
    const startDate = await callTeacherFunction("get_teacher_class_first_lesson_date", {
      target_class_number: classNumber
    });
    document.getElementById("classStartDate").value = startDate || "";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const classNumber = getClassNumber();
    const dateInput = document.getElementById("classStartDate");
    const saveButton = document.getElementById("saveClassStartDateButton");

    if (!classNumber || !dateInput.value) {
      setMessage("Informe a primeira data de aula da turma.", true);
      return;
    }

    saveButton.disabled = true;
    setMessage("Salvando data de início...", false);

    try {
      await callTeacherFunction("set_teacher_class_first_lesson_date", {
        target_class_number: classNumber,
        target_first_lesson_date: dateInput.value
      });
      await loadClassStartDate(classNumber);
      setMessage("Data inicial salva. As aulas anteriores não serão contabilizadas.", false);
    } catch (error) {
      setMessage("Não foi possível salvar a data: " + (error.message || "erro desconhecido"), true);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function initialize() {
    const form = document.getElementById("classStartDateForm");
    const classNumber = getClassNumber();
    if (!form || !classNumber) return;
    form.addEventListener("submit", handleSubmit);

    try {
      await loadClassStartDate(classNumber);
    } catch (error) {
      setMessage("Não foi possível consultar a data inicial: " +
        (error.message || "erro desconhecido"), true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

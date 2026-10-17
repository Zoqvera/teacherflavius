(function (root) {
  "use strict";

  const DIALOG_ID = "studentAcquisitionPrompt";
  const FORM_ID = "studentAcquisitionPromptForm";
  const ERROR_ID = "studentAcquisitionPromptError";
  const SOURCE_ID = "studentAcquisitionPromptSource";
  const DETAIL_ID = "studentAcquisitionPromptDetail";
  const SUBMIT_ID = "studentAcquisitionPromptSubmit";
  const CLOSE_ID = "studentAcquisitionPromptClose";
  const SAVED_ID = "studentAcquisitionSaved";

  function shouldShowPrompt(profileResponse, acquisitionResponse) {
    if (profileResponse.error) throw profileResponse.error;
    if (acquisitionResponse.error) throw acquisitionResponse.error;

    const profile = profileResponse.data;
    const acquisition = acquisitionResponse.data || {};
    return Boolean(profile && profile.enrolled === true &&
      profile.archived !== true && !acquisition.source);
  }

  function setError(documentRef, message) {
    const error = documentRef.getElementById(ERROR_ID);
    if (!error) return;
    error.textContent = message || "";
    error.hidden = !message;
  }

  function registerHandlers(settings) {
    const { dialog, documentRef, client, acquisitionService } = settings;
    const form = documentRef.getElementById(FORM_ID);
    const submit = documentRef.getElementById(SUBMIT_ID);
    const close = documentRef.getElementById(CLOSE_ID);
    let saving = false;

    close.addEventListener("click", function () {
      if (!saving) dialog.close();
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (saving) return;
      setError(documentRef, "");

      let answer;
      try {
        answer = acquisitionService.read(SOURCE_ID, DETAIL_ID, true);
      } catch (error) {
        setError(documentRef, error.message);
        return;
      }

      saving = true;
      submit.disabled = true;
      close.disabled = true;
      try {
        const result = await client.rpc("submit_my_student_acquisition", {
          target_source: answer.source,
          target_detail: answer.detail
        });
        if (result.error) throw result.error;
        dialog.close();
        const saved = documentRef.getElementById(SAVED_ID);
        if (saved) {
          saved.hidden = false;
          saved.textContent = result.data === false
            ? "Sua origem já estava registrada."
            : "Resposta registrada. Obrigado!";
        }
      } catch (error) {
        setError(documentRef, error.message || "Não foi possível salvar sua resposta. Tente novamente.");
      } finally {
        saving = false;
        submit.disabled = false;
        close.disabled = false;
      }
    });
  }

  async function initialize(options) {
    const settings = options || {};
    const documentRef = settings.documentRef || (root && root.document);
    const client = settings.client;
    const studentId = settings.studentId;
    const dialog = settings.dialog || (documentRef && documentRef.getElementById(DIALOG_ID));
    const acquisitionService = settings.acquisitionService ||
      (root && root.StudentAcquisition);

    if (settings.isProfessor || !client || !studentId || !dialog ||
        !acquisitionService || typeof dialog.showModal !== "function") {
      return false;
    }

    try {
      const responses = await Promise.all([
        client.from("profiles").select("enrolled,archived").eq("id", studentId).maybeSingle(),
        client.rpc("get_my_student_acquisition")
      ]);
      if (!shouldShowPrompt(responses[0], responses[1])) return false;

      // A pesquisa não deve disputar foco com outro diálogo aberto.
      if (documentRef.querySelector("dialog[open]")) return false;

      acquisitionService.setup(SOURCE_ID, DETAIL_ID);
      registerHandlers({ dialog, documentRef, client, acquisitionService });
      setError(documentRef, "");
      dialog.showModal();
      return true;
    } catch (error) {
      console.warn("Não foi possível verificar a pesquisa de origem do aluno:", error);
      return false;
    }
  }

  const api = Object.freeze({
    initialize: initialize,
    shouldShowPrompt: shouldShowPrompt
  });

  if (root) root.StudentAcquisitionPrompt = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window === "undefined" ? null : window);

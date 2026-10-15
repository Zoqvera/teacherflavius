(function (root) {
  "use strict";

  function getClient(auth) {
    if (!auth || typeof auth.getClient !== "function") {
      throw new Error("Autenticação indisponível.");
    }
    const client = auth.getClient();
    if (!client || typeof client.from !== "function" || typeof client.rpc !== "function") {
      throw new Error("Conexão com o banco indisponível.");
    }
    return client;
  }

  function unwrap(result) {
    if (!result || result.error) {
      throw new Error(result && result.error && result.error.message ||
        "Não foi possível concluir a operação.");
    }
    return result.data;
  }

  async function listExercises(auth) {
    const client = getClient(auth);
    const response = await client.from("exercises")
      .select("id,exercise_number,activity_type,title,status,published_version_id")
      .order("exercise_number", { ascending: true });
    return unwrap(response) || [];
  }

  async function listVersions(auth, exerciseId) {
    const client = getClient(auth);
    const response = await client.from("exercise_versions")
      .select("id,version_number,status,content,created_at")
      .eq("exercise_id", exerciseId)
      .order("version_number", { ascending: false })
      .limit(30);
    return unwrap(response) || [];
  }

  async function listQuestions(auth, versionId) {
    const client = getClient(auth);
    const response = await client.from("exercise_questions")
      .select("position,prompt,question_type,answer_key,options,explanation")
      .eq("version_id", versionId)
      .order("position", { ascending: true });
    return unwrap(response) || [];
  }

  async function createDraft(auth) {
    return unwrap(await getClient(auth).rpc("homework_create_draft"));
  }

  async function saveVersion(auth, draft) {
    if (!draft || !draft.exerciseId || !draft.title ||
        !draft.content || !Array.isArray(draft.questions)) {
      throw new TypeError("Rascunho incompleto.");
    }
    return unwrap(await getClient(auth).rpc("homework_save_version", {
      p_exercise_id: draft.exerciseId,
      p_title: draft.title,
      p_content: draft.content,
      p_questions: draft.questions
    }));
  }

  async function approveVersion(auth, versionId) {
    return unwrap(await getClient(auth).rpc("homework_approve_version", {
      p_version_id: versionId
    }));
  }

  async function publishVersion(auth, versionId) {
    return unwrap(await getClient(auth).rpc("homework_publish", {
      p_version_id: versionId
    }));
  }

  root.HomeworkAdminService = Object.freeze({
    listExercises: listExercises,
    listVersions: listVersions,
    listQuestions: listQuestions,
    createDraft: createDraft,
    saveVersion: saveVersion,
    approveVersion: approveVersion,
    publishVersion: publishVersion
  });
})(window);

(function (root) {
  "use strict";

  const EDGE_FUNCTION = "homework-student";
  const ACTIONS = Object.freeze({
    LIST: "list",
    DETAIL: "detail",
    PROGRESS: "progress",
    SUBMIT: "submit"
  });

  function clientFrom(auth) {
    if (!auth || typeof auth.getClient !== "function") {
      throw new Error("Autenticação indisponível.");
    }
    const client = auth.getClient();
    if (!client || !client.functions || typeof client.functions.invoke !== "function") {
      throw new Error("Serviço de tarefas indisponível.");
    }
    return client;
  }

  async function request(auth, action, values) {
    const client = clientFrom(auth);
    const result = await client.functions.invoke(EDGE_FUNCTION, {
      body: { action: action, ...(values || {}) }
    });
    if (!result || result.error || (result.data && result.data.error)) {
      const error = result && (result.data && result.data.error || result.error && result.error.message);
      throw new Error(error || "Não foi possível concluir a solicitação.");
    }
    return result.data;
  }

  function createSubmissionKey() {
    if (!root.crypto || typeof root.crypto.randomUUID !== "function") {
      throw new Error("Identificador seguro de envio indisponível.");
    }
    return root.crypto.randomUUID();
  }

  function makeSubmission(assignmentId, answers) {
    if (!assignmentId || answers == null) throw new TypeError("Entrega incompleta.");
    return Object.freeze({
      assignment_id: assignmentId,
      submission_key: createSubmissionKey(),
      answers: answers
    });
  }

  // Repetir o mesmo objeto de envio ao tentar novamente evita duplicar respostas.
  async function submit(auth, submission) {
    if (!submission || !submission.assignment_id || !submission.submission_key ||
        submission.answers == null) {
      throw new TypeError("Envio incompleto.");
    }
    return request(auth, ACTIONS.SUBMIT, submission);
  }

  root.HomeworkStudentService = Object.freeze({
    list: auth => request(auth, ACTIONS.LIST),
    detail: (auth, assignmentId) => request(auth, ACTIONS.DETAIL, { assignment_id: assignmentId }),
    progress: (auth, assignmentId) => request(auth, ACTIONS.PROGRESS, { assignment_id: assignmentId }),
    makeSubmission: makeSubmission,
    submit: submit
  });
})(window);

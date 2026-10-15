(function (root) {
  "use strict";

  function rpcClient(auth) {
    if (!auth || typeof auth.getClient !== "function") {
      throw new Error("Autenticação do professor indisponível.");
    }
    const client = auth.getClient();
    if (!client || typeof client.rpc !== "function") {
      throw new Error("Serviço de revisão indisponível.");
    }
    return client;
  }

  function resultOrThrow(result) {
    if (!result || result.error) {
      throw new Error(result?.error?.message || "Falha ao revisar resposta.");
    }
    return result.data;
  }

  async function queue(auth) {
    const result = await rpcClient(auth).rpc("homework_review_queue", { p_limit: 100 });
    const rows = resultOrThrow(result);
    if (!Array.isArray(rows)) throw new Error("Fila de revisão inválida.");
    return rows;
  }

  async function review(auth, answerId, score, comment) {
    if (typeof answerId !== "string" || !answerId.trim() ||
        typeof score !== "number" || !Number.isFinite(score) ||
        score < 0 || score > 10 ||
        typeof comment !== "string" || comment.trim().length < 10 ||
        comment.trim().length > 1000) {
      throw new TypeError("Informe resposta, nota de 0 a 10 e justificativa de 10 a 1.000 caracteres.");
    }
    return resultOrThrow(await rpcClient(auth).rpc("homework_review_answer", {
      p_answer_id: answerId,
      p_score: score,
      p_comment: comment.trim()
    }));
  }

  root.HomeworkTeacherReviewService = Object.freeze({ queue: queue, review: review });
})(window);

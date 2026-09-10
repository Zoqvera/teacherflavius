(function () {
  "use strict";

  const ACTIVITY_RESULTS_TABLE = "activity_results";

  function assertDependencies(dependencies) {
    const requiredFunctions = ["getClient", "getUser"];

    requiredFunctions.forEach(function (name) {
      if (typeof dependencies[name] !== "function") {
        throw new Error("Dependência inválida do serviço de progresso: " + name + ".");
      }
    });
  }

  function buildActivityResultPayload(userId, result) {
    const source = result || {};
    const score = Number(source.score);
    const total = Number(source.total);

    return {
      user_id: userId,
      activity_type: source.activity_type || source.type || "activity",
      activity_title: source.activity_title || source.quiz || source.title,
      score: score,
      total: total,
      percentage: Math.round((score / total) * 100),
      completed_at: new Date().toISOString()
    };
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    async function saveActivityResult(result) {
      const client = deps.getClient();
      const user = await deps.getUser();
      if (!client || !user) return null;

      const payload = buildActivityResultPayload(user.id, result);
      const response = await client.from(ACTIVITY_RESULTS_TABLE).insert(payload).select().single();
      if (response.error) {
        console.warn("Erro ao salvar no Supabase:", response.error.message);
        return null;
      }
      return response.data;
    }

    async function getMyResults() {
      const client = deps.getClient();
      const user = await deps.getUser();
      if (!client || !user) return [];

      const response = await client
        .from(ACTIVITY_RESULTS_TABLE)
        .select("*")
        .eq("user_id", user.id)
        .order("completed_at", { ascending: false });

      if (response.error) return [];
      return response.data || [];
    }

    return Object.freeze({
      saveActivityResult: saveActivityResult,
      getMyResults: getMyResults
    });
  }

  window.ActivityProgressService = Object.freeze({
    create: create
  });
})();
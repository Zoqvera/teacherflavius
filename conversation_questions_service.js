(function () {
  "use strict";

  const QUESTIONS_TABLE = "conversation_questions";
  const COMPLETIONS_TABLE = "conversation_question_completions";
  const PROFILES_TABLE = "profiles";
  const MOVE_RPC = "move_conversation_question";

  function requireClient(client) {
    if (!client) throw new Error("Supabase client is required.");
    return client;
  }

  function assertText(value, label, maxLength) {
    const normalized = String(value || "").trim();
    if (!normalized) throw new Error("Preencha " + label + ".");
    if (normalized.length > maxLength) {
      throw new Error(label + " deve ter no máximo " + maxLength + " caracteres.");
    }
    return normalized;
  }

  function normalizeExamples(examples) {
    if (!Array.isArray(examples) || examples.length !== 5) {
      throw new Error("Cadastre exatamente cinco exemplos de respostas.");
    }

    return examples.map(function (example, index) {
      return {
        answer: assertText(example && example.answer, "a resposta " + (index + 1), 500),
        translation: assertText(example && example.translation, "a tradução da resposta " + (index + 1), 500),
        note: assertText(example && example.note, "a explicação da resposta " + (index + 1), 1000)
      };
    });
  }

  function completionKey(questionId, studentId) {
    return String(questionId) + ":" + String(studentId);
  }

  function create(client) {
    const supabase = requireClient(client);

    async function listQuestions() {
      const response = await supabase
        .from(QUESTIONS_TABLE)
        .select("id,question_text,question_translation,answer_examples,display_order,created_at")
        .order("display_order", { ascending: true })
        .order("id", { ascending: true });

      if (response.error) throw response.error;
      return response.data || [];
    }

    async function getStudentProfile(studentId) {
      const response = await supabase
        .from(PROFILES_TABLE)
        .select("id,name,email,enrolled,archived")
        .eq("id", studentId)
        .maybeSingle();

      if (response.error) throw response.error;
      return response.data || null;
    }

    async function listStudentCompletions(studentId) {
      const response = await supabase
        .from(COMPLETIONS_TABLE)
        .select("question_id,student_id,completed_at")
        .eq("student_id", studentId)
        .order("question_id", { ascending: true });

      if (response.error) throw response.error;
      return response.data || [];
    }

    async function addQuestion(questionCard, displayOrder) {
      const payload = {
        question_text: assertText(questionCard && questionCard.text, "a pergunta", 500),
        question_translation: assertText(questionCard && questionCard.translation, "a tradução da pergunta", 500),
        answer_examples: normalizeExamples(questionCard && questionCard.examples),
        display_order: displayOrder
      };
      const response = await supabase
        .from(QUESTIONS_TABLE)
        .insert(payload)
        .select("id,question_text,question_translation,answer_examples,display_order,created_at")
        .single();

      if (response.error) throw response.error;
      return response.data;
    }

    async function moveQuestion(questionId, direction) {
      if (!["up", "down"].includes(direction)) {
        throw new Error("Direção de ordenação inválida.");
      }

      const response = await supabase.rpc(MOVE_RPC, {
        p_question_id: questionId,
        p_direction: direction
      });
      if (response.error) throw response.error;
    }

    return Object.freeze({
      addQuestion,
      completionKey,
      getStudentProfile,
      listQuestions,
      listStudentCompletions,
      moveQuestion
    });
  }

  window.ConversationQuestionsService = Object.freeze({
    create,
    completionKey
  });
})();

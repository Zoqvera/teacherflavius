(function () {
  "use strict";

  const COMPLETION_PAGE_SIZE = 1000;
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

    async function listActiveStudents() {
      const response = await supabase
        .from(PROFILES_TABLE)
        .select("id,name,email")
        .eq("enrolled", true)
        .eq("archived", false)
        .order("name", { ascending: true, nullsFirst: false })
        .order("email", { ascending: true, nullsFirst: false });

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

    async function listAllCompletions() {
      const rows = [];
      let start = 0;

      while (true) {
        const response = await supabase
          .from(COMPLETIONS_TABLE)
          .select("question_id,student_id,completed_at")
          .order("question_id", { ascending: true })
          .order("student_id", { ascending: true })
          .range(start, start + COMPLETION_PAGE_SIZE - 1);

        if (response.error) throw response.error;
        const page = response.data || [];
        rows.push(...page);
        if (page.length < COMPLETION_PAGE_SIZE) break;
        start += COMPLETION_PAGE_SIZE;
      }

      return rows;
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

    async function setCompletion(questionId, studentId, completed, teacherId) {
      if (completed) {
        const response = await supabase
          .from(COMPLETIONS_TABLE)
          .insert({
            question_id: questionId,
            student_id: studentId,
            marked_by: teacherId
          });
        if (response.error) throw response.error;
        return;
      }

      const response = await supabase
        .from(COMPLETIONS_TABLE)
        .delete()
        .eq("question_id", questionId)
        .eq("student_id", studentId);

      if (response.error) throw response.error;
    }

    return Object.freeze({
      addQuestion,
      completionKey,
      getStudentProfile,
      listActiveStudents,
      listAllCompletions,
      listQuestions,
      listStudentCompletions,
      moveQuestion,
      setCompletion
    });
  }

  window.ConversationQuestionsService = Object.freeze({
    create,
    completionKey
  });
})();

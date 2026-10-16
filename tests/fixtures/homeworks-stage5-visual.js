(function () {
  "use strict";

  // Somente fixtures de navegador local. Zero Supabase, usuário, rede ou OpenAI.
  const params = new URLSearchParams(location.search);
  const activity = params.get("activity") || "writing";
  const state = params.get("state") || "initial";
  const activities = Object.freeze({
    reading: { number: 1, title: "A day at school", content: {
      passage: "Today I wake up early and read a book. Then I go to school. " +
        "After class I talk to my friends and go home.",
      instructions: ["Read the text. Answer all questions in English."]
    }, questions: [
      { id: "q-1", prompt: "When does the student wake up?",
        question_type: "multiple_choice", options: ["Early", "Late"], points: 2 },
      { id: "q-2", prompt: "What happens after class?",
        question_type: "short_answer", points: 1 }
    ] },
    writing: { number: 2, title: "My last school day", content: {
      prompt: "Write three sentences about a school day. " +
        "Use the simple past and describe what you studied.",
      guidelines: ["Write at least 20 characters.", "Use English."]
    }, questions: [] },
    grammar: { number: 3, title: "Simple present", content: {
      explanation: "Use he, she, it with -s in the simple present.",
      examples: ["She studies English.", "They study English."]
    }, questions: [
      { id: "q-3", prompt: "She ____ English.",
        question_type: "multiple_choice", options: ["study", "studies"], points: 1 },
      { id: "q-4", prompt: "I ____ English every day.",
        question_type: "short_answer", points: 1 }
    ] }
  });

  const selected = activities[activity];
  if (!selected || !["initial", "submitted", "evaluated"].includes(state)) {
    document.documentElement.dataset.qaResult = "INVALID_SCENARIO";
    return;
  }
  const assignmentId = "00000000-0000-4000-8000-000000000021";
  const progress = state === "evaluated" ? {
    status: "evaluated", score: activity === "writing" ? 7.7 : 9,
    feedback: activity === "writing" ? [{
      source: "ai", score: 7.7,
      general_comment: "O texto está claro, mas os verbos precisam estar no passado.",
      original_text: "Yesterday I go to school and study English.",
      corrected_text: "Yesterday I went to school and studied English.",
      explanations: [
        "Cumprimento do enunciado: 8/10 (peso 40%).",
        "Precisão linguística: 6/10 (peso 30%).",
        "Clareza e vocabulário: 9/10 (peso 30%).",
        "Use went para o passado de go."
      ]
    }] : [{
      source: "automatic", score: 9,
      general_comment: "Correção automática por comparação ao gabarito."
    }]
  } : state === "submitted" ? {
    status: "submitted", score: null, feedback: []
  } : { status: "not_started", score: null, feedback: [] };

  const detail = {
    assignment_id: assignmentId, title: selected.title,
    exercise_number: selected.number, activity_type: activity,
    content: selected.content, questions: selected.questions
  };
  const service = {
    list: async () => ({ assignments: [{
      assignment_id: assignmentId, title: detail.title,
      exercise_number: detail.exercise_number, activity_type: activity,
      status: progress.status, score: progress.score
    }] }),
    detail: async () => detail,
    progress: async () => progress,
    retryCorrection: async () => progress,
    makeSubmission: () => { throw new Error("Envios indisponíveis no cenário visual."); },
    submit: () => { throw new Error("Envios indisponíveis no cenário visual."); }
  };

  const controller = window.HomeworkStudentInterface.create({
    mount: document.getElementById("visualMount"),
    notice: document.getElementById("visualNotice"),
    auth: {},
    service,
    feedbackRenderer: window.HomeworkPedagogicalPreview
  });

  controller.open(assignmentId).then(function () {
    // Measure DOM after the UI module actually rendered a full scenario.
    requestAnimationFrame(function () {
      const mount = document.getElementById("visualMount");
      const visibleButtons = Array.from(mount.querySelectorAll("button"));
      const unnamed = visibleButtons.some(button => !button.textContent.trim());
      const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
      const writingDisclosure = !((activity === "writing" && state === "initial")) ||
        mount.textContent.includes("as verificações de privacidade e faixa etária") &&
        mount.textContent.includes("Quando autorizada") &&
        mount.textContent.includes("OpenAI");
      const correctStatus = state !== "evaluated" || mount.textContent.includes("Nota:");
      const result = !overflow && !unnamed && writingDisclosure && correctStatus ?
        "PASS" : "FAIL";
      document.documentElement.dataset.qaResult = result;
      document.documentElement.dataset.qaOverflow = String(overflow);
      document.documentElement.dataset.qaActivity = activity;
      document.documentElement.dataset.qaState = state;
    });
  }).catch(function () {
    document.documentElement.dataset.qaResult = "FAIL";
  });
})();

(function (root) {
  "use strict";

  const CANCELLED_STATUSES = Object.freeze(["cancelled", "cancelled_finalized"]);

  function isCancelled(item) {
    return CANCELLED_STATUSES.includes(item.attendance_status);
  }

  function classKey(item) {
    return String(item.class_number) + "|" + String(item.starts_at);
  }

  function previousStudyKey(item) {
    return String(item.lesson_kind || "regular") + "|" + String(item.entry_id);
  }

  function indexPreviousStudies(records) {
    const studies = new Map();
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (!record || !record.entry_id) return;
      studies.set(previousStudyKey(record), {
        previousStartsAt: record.previous_starts_at || null,
        questions: Array.isArray(record.questions) ? record.questions : []
      });
    });
    return studies;
  }

  function withPreviousClassQuestions(items, studiesByEntry) {
    const histories = studiesByEntry instanceof Map ? studiesByEntry : new Map();
    return (Array.isArray(items) ? items : []).map(function (item) {
      const previous = histories.get(previousStudyKey(item));
      return Object.assign({}, item, {
        previous_class_questions: previous && Array.isArray(previous.questions)
          ? previous.questions : []
      });
    });
  }

  function groupByClass(items) {
    const groups = new Map();
    (Array.isArray(items) ? items : []).forEach(function (item) {
      const key = classKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups, function (entry) {
      const students = entry[1];
      return {
        key: entry[0],
        classNumber: students[0].class_number,
        className: students[0].class_name || "Turma " + students[0].class_number,
        startsAt: students[0].starts_at,
        students: students.slice().sort(function (first, second) {
          return Number(isCancelled(first)) - Number(isCancelled(second)) ||
            first.student_name.localeCompare(second.student_name, "pt-BR");
        })
      };
    }).sort(function (first, second) {
      return new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime();
    });
  }

  function normalizeNumbers(values) {
    return Array.from(new Set(
      (Array.isArray(values) ? values : [])
        .map(Number)
        .filter(function (value) { return Number.isSafeInteger(value) && value > 0; })
    )).sort(function (first, second) { return first - second; });
  }

  function studiedNumbers(items) {
    const numbers = [];
    (Array.isArray(items) ? items : []).forEach(function (item) {
      numbers.push.apply(numbers, normalizeNumbers(item.previously_studied_numbers));
    });
    return normalizeNumbers(numbers);
  }

  function questionsForStudent(item, catalog) {
    const questionCatalog = catalog instanceof Map ? catalog : new Map();
    const todayQuestions = Array.isArray(item.today_questions) ? item.today_questions : [];
    const previousQuestions = Array.isArray(item.previous_class_questions)
      ? item.previous_class_questions : [];
    const reviewQuestions = Array.isArray(item.review_questions) ? item.review_questions : [];
    const newQuestions = Array.isArray(item.new_questions) ? item.new_questions : [];
    const seen = new Set();

    function uniqueQuestions(questions) {
      return questions.filter(function (question) {
        const id = String(question && question.id || "").toLowerCase();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    // The teacher plan can contain studies made after a historical lesson date.
    // Restrict pending actions to questions confirmed by the dated study history.
    const studiedNumbersForDate = new Set(normalizeNumbers(
      normalizeNumbers(item.previously_studied_numbers).concat(
        todayQuestions.map(function (question) { return question.display_order; })
      )
    ));

    const today = uniqueQuestions(todayQuestions);
    const previous = uniqueQuestions(previousQuestions);
    const review = uniqueQuestions(reviewQuestions);
    const pending = uniqueQuestions(newQuestions.filter(function (question) {
      return studiedNumbersForDate.has(Number(question.display_order));
    }));

    const byNumber = new Map();
    normalizeNumbers(item.previously_studied_numbers).forEach(function (number) {
      const question = questionCatalog.get(number);
      if (question) byNumber.set(number, question);
    });
    todayQuestions.forEach(function (question) {
      const number = Number(question.display_order);
      if (Number.isSafeInteger(number) && number > 0) byNumber.set(number, question);
    });

    return {
      today: today,
      previous: previous,
      review: review,
      pending: pending,
      all: Array.from(byNumber.values()).sort(function (a, b) {
        return Number(a.display_order) - Number(b.display_order);
      })
    };
  }

  function classSummary(group) {
    const active = group.students.filter(function (item) { return !isCancelled(item); });
    return {
      total: active.length,
      cancelled: group.students.length - active.length,
      presented: active.filter(function (item) {
        return item.lesson_status === "presented";
      }).length,
      studiedToday: active.reduce(function (count, item) {
        return count + (Array.isArray(item.today_questions) ? item.today_questions.length : 0);
      }, 0)
    };
  }

  const api = Object.freeze({
    classKey: classKey,
    classSummary: classSummary,
    groupByClass: groupByClass,
    indexPreviousStudies: indexPreviousStudies,
    previousStudyKey: previousStudyKey,
    isCancelled: isCancelled,
    normalizeNumbers: normalizeNumbers,
    questionsForStudent: questionsForStudent,
    studiedNumbers: studiedNumbers,
    withPreviousClassQuestions: withPreviousClassQuestions
  });
  root.TeacherWorkspaceModel = api;
})(typeof window !== "undefined" ? window : globalThis);

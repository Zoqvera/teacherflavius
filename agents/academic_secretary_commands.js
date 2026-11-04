(function (browser) {
  "use strict";

  const ACTIONS = Object.freeze({
    INSPECT_STUDENT: "inspect_student",
    NEW_LINK: "new_link",
    TRANSFER: "transfer",
    ARCHIVE: "archive",
    UNARCHIVE: "unarchive",
    INSPECT_CLASS: "inspect_class",
    AVAILABLE_CLASSES: "available_classes"
  });

  const SOURCE_ALIASES = Object.freeze({
    "instagram": "instagram",
    "facebook": "facebook",
    "chatgpt": "chatgpt",
    "google": "google",
    "indicacao": "referral",
    "indicação": "referral",
    "getninjas": "getninjas",
    "outra": "other",
    "outras": "other",
    "outros": "other",
    "nao lembro": "unknown",
    "não lembro": "unknown"
  });

  const GRAMMAR = Object.freeze([
    {
      action: ACTIONS.INSPECT_STUDENT,
      expressions: [
        /^(?:em\s+)?qual\s+turma\s+(?:est[aá]\s+)?(?:o\s+aluno\s+|a\s+aluna\s+|do\s+|da\s+|de\s+|o\s+|a\s+)?(?<name>.+?)(?:\s+est[aá])?\s*\??$/iu,
        /^(?<name>.+?)\s+est[aá]\s+(?:vinculad[oa]\s+)?(?:em|a)\s+qual\s+turma\s*\??$/iu,
        /^(?:consulte|consultar|verifique|verificar)\s+(?:os\s+v[ií]nculos\s+(?:do|da|de)\s+|a\s+turma\s+(?:do|da|de)\s+)(?<name>.+?)\s*\??$/iu
      ]
    },
    {
      action: ACTIONS.TRANSFER,
      expressions: [
        /^(?:transfira|transferir|mova)\s+(?:o\s+aluno\s+|a\s+aluna\s+|o\s+|a\s+)?(?<name>.+?)\s+(?:da|de)\s+turma\s+(?<from>\d+)\s+para\s+(?:a\s+)?turma\s+(?<to>\d+)\s*[.!]?$/iu,
        /^(?:transfira|transferir|mova)\s+(?:o\s+aluno\s+|a\s+aluna\s+|o\s+|a\s+)?(?<name>.+?)\s+para\s+(?:a\s+)?turma\s+(?<to>\d+)\s*[.!]?$/iu
      ]
    },
    {
      action: ACTIONS.NEW_LINK,
      expressions: [
        /^(?:vincule|vincular|matricule|matricular)\s+(?:o\s+aluno\s+|a\s+aluna\s+|o\s+|a\s+)?(?<name>.+?)\s+(?:à|a|na|em|para\s+a)\s+turma\s+(?<to>\d+)(?<tail>.*)$/iu
      ]
    },
    {
      action: ACTIONS.ARCHIVE,
      expressions: [/^(?:arquive|arquivar)\s+(?:o\s+aluno\s+|a\s+aluna\s+|o\s+|a\s+)?(?<name>.+?)\s*[.!]?$/iu]
    },
    {
      action: ACTIONS.UNARCHIVE,
      expressions: [/^(?:desarquive|desarquivar)\s+(?:o\s+aluno\s+|a\s+aluna\s+|o\s+|a\s+)?(?<name>.+?)\s*[.!]?$/iu]
    },
    {
      action: ACTIONS.INSPECT_CLASS,
      expressions: [
        /^(?:quantas\s+)?vagas\s+(?:(?:h[aá]|tem|dispon[ií]veis)\s+)?(?:na|da|para\s+a)\s+turma\s+(?<number>\d+)\s*\??$/iu,
        /^turma\s+(?<number>\d+)\s+(?:tem\s+)?(?:quantas\s+)?vagas(?:\s+dispon[ií]veis)?\s*\??$/iu
      ]
    },
    {
      action: ACTIONS.AVAILABLE_CLASSES,
      expressions: [
        /^(?:quais\s+turmas\s+(?:t[eê]m|possuem|est[aã]o\s+com)\s+vagas|(?:liste|listar|mostre|mostrar)\s+(?:as\s+)?turmas\s+com\s+vagas)\s*\??$/iu
      ]
    }
  ]);

  function canonicalName(name) {
    if (typeof name !== "string") return null;
    const cleaned = name.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
    return cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : null;
  }

  function positiveClassNumber(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function normalizeDate(value) {
    if (typeof value !== "string") return null;
    const pieces = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value.split("-").map(Number)
      : (function () {
          const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
          return match ? [Number(match[3]), Number(match[2]), Number(match[1])] : null;
        })();
    if (!pieces) return null;
    const [year, month, day] = pieces;
    const actual = new Date(Date.UTC(year, month - 1, day));
    if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 ||
        actual.getUTCDate() !== day) return null;
    return [year, month, day].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-");
  }

  function parseLinkSupplement(tail) {
    if (!tail || !tail.trim()) return {};
    const sourceMatch = /(?:^|[,;])\s*origem\s*:?\s*(instagram|facebook|chatgpt|google|indica[cç][aã]o|getninjas|outras|outra|outros|n[aã]o\s+lembro)\b/iu.exec(tail);
    const dateMatch = /(?:^|[,;])\s*primeira\s+aula\s*(?:em\s+|no\s+dia\s*)?:?\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/iu.exec(tail);
    // Refuse unknown trailing text instead of silently discarding instructions.
    let remainder = tail;
    if (sourceMatch) remainder = remainder.replace(sourceMatch[0], "");
    if (dateMatch) remainder = remainder.replace(dateMatch[0], "");
    if (remainder.replace(/^[,;\s]+|[,;.\s]+$/g, "").trim()) {
      return { unsupportedSupplement: true };
    }
    const result = {};
    if (sourceMatch) result.source = SOURCE_ALIASES[sourceMatch[1].toLowerCase().replace(/\s+/g, " ")];
    if (dateMatch) {
      result.firstLessonDate = normalizeDate(dateMatch[1]);
      if (!result.firstLessonDate) return { invalidDate: true };
    }
    return result;
  }

  function unsupported(message) {
    return Object.freeze({ status: "unsupported", message });
  }

  function parseAcademicCommand(input) {
    if (typeof input !== "string" || !input.trim() || input.length > 300) {
      return unsupported("Informe um comando entre 1 e 300 caracteres.");
    }
    const command = input.trim().replace(/\s+/g, " ")
      .replace(/^(?:por\s+favor\s*[,;]?\s*|quero\s+que\s+voc[eê]\s+|quero\s+(?=(?:vincular|matricular|transferir|arquivar|desarquivar)\b)|preciso\s+que\s+voc[eê]\s+)/iu, "");
    for (const entry of GRAMMAR) {
      for (const expression of entry.expressions) {
        const match = expression.exec(command);
        if (!match) continue;
        const fields = match.groups || {};
        if (entry.action === ACTIONS.AVAILABLE_CLASSES) {
          return Object.freeze({ status: "recognized", action: entry.action });
        }
        if (entry.action === ACTIONS.INSPECT_CLASS) {
          const classNumber = positiveClassNumber(fields.number);
          return classNumber
            ? Object.freeze({ status: "recognized", action: entry.action, classNumber })
            : unsupported("Número de turma inválido.");
        }
        const studentName = canonicalName(fields.name);
        if (!studentName) return unsupported("Não consegui identificar o nome do aluno.");
        const result = { status: "recognized", action: entry.action, studentName };
        if (entry.action === ACTIONS.NEW_LINK || entry.action === ACTIONS.TRANSFER) {
          result.classNumber = positiveClassNumber(fields.to);
          if (!result.classNumber) return unsupported("Número de turma inválido.");
        }
        if (entry.action === ACTIONS.TRANSFER && fields.from) {
          result.fromClassNumber = positiveClassNumber(fields.from);
          if (!result.fromClassNumber || result.fromClassNumber === result.classNumber) {
            return unsupported("As turmas de origem e destino devem ser diferentes.");
          }
        }
        if (entry.action === ACTIONS.NEW_LINK) {
          const supplement = parseLinkSupplement(fields.tail);
          if (supplement.unsupportedSupplement || supplement.invalidDate) {
            return unsupported("Não consegui interpretar as informações complementares; use os campos do formulário.");
          }
          Object.assign(result, supplement);
        }
        return Object.freeze(result);
      }
    }
    return unsupported("Comando não reconhecido. Consulte um aluno, indique uma turma por número ou peça uma prévia.");
  }

  const api = Object.freeze({ ACTIONS, parseAcademicCommand });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (browser) browser.TeacherAcademicCommands = api;
})(typeof window !== "undefined" ? window : null);

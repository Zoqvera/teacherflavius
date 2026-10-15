(function (root) {
  "use strict";

  const TIME_ZONE = "America/Sao_Paulo";
  const encoder = new TextEncoder();

  function formatUtc(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Horário inválido para calendário.");
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function validateEvent(event) {
    const studentId = String(event.studentId || "").trim();
    const classNumber = Number(event.classNumber);
    const className = String(event.className || "").trim();
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    if (!/^[a-f0-9-]{36}$/i.test(studentId)
      || !Number.isSafeInteger(classNumber) || classNumber <= 0
      || !className || !Number.isFinite(start.getTime())
      || !Number.isFinite(end.getTime()) || end <= start) {
      throw new Error("Os dados da reposição estão incompletos para criar o calendário.");
    }
    let meetingUrl = "";
    if (event.meetingUrl) {
      try {
        const url = new URL(String(event.meetingUrl));
        if (url.protocol === "https:" || url.protocol === "http:") meetingUrl = url.toString();
      } catch {
        // Do not include malformed links in invitations.
      }
    }
    return { studentId, classNumber, className, start, end, meetingUrl };
  }

  function getUid(event) {
    return "reposicao-" + event.studentId + "-" + event.classNumber + "-"
      + formatUtc(event.start) + "@teacherflavius.com";
  }

  function googleCalendarUrl(input) {
    const event = validateEvent(input);
    const url = new URL("https://calendar.google.com/calendar/r/eventedit");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("dates", formatUtc(event.start) + "/" + formatUtc(event.end));
    url.searchParams.set("stz", TIME_ZONE);
    url.searchParams.set("etz", TIME_ZONE);
    url.searchParams.set("text", "Reposição de inglês — " + event.className);
    url.searchParams.set("details", "Turma: " + event.className
      + "\nReposição agendada pelo TeacherFlavius."
      + (event.meetingUrl ? "\nLink da aula: " + event.meetingUrl : ""));
    if (event.meetingUrl) url.searchParams.set("location", event.meetingUrl);
    return url.toString();
  }

  function escapeIcs(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n")
      .replace(/;/g, "\\;").replace(/,/g, "\\,");
  }

  function foldLines(lines) {
    const folded = [];
    lines.forEach(function (line) {
      let fragment = "";
      let bytes = 0;
      for (const character of line) {
        const size = encoder.encode(character).length;
        if (bytes + size > 75) {
          folded.push(fragment);
          fragment = " " + character;
          bytes = size + 1;
        } else {
          fragment += character;
          bytes += size;
        }
      }
      folded.push(fragment);
    });
    return folded.join("\r\n") + "\r\n";
  }

  function icsContent(input, createdAt) {
    const event = validateEvent(input);
    const now = createdAt || new Date();
    const description = "Turma: " + event.className + "\nReposição agendada pelo TeacherFlavius."
      + (event.meetingUrl ? "\nLink da aula: " + event.meetingUrl : "");
    return foldLines([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TeacherFlavius//Reposicoes//PT-BR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + getUid(event),
      "DTSTAMP:" + formatUtc(now),
      "DTSTART:" + formatUtc(event.start),
      "DTEND:" + formatUtc(event.end),
      "SUMMARY:" + escapeIcs("Reposição de inglês — " + event.className),
      "DESCRIPTION:" + escapeIcs(description),
      ...(event.meetingUrl ? ["LOCATION:" + escapeIcs(event.meetingUrl)] : []),
      "STATUS:CONFIRMED",
      "SEQUENCE:0",
      "END:VEVENT",
      "END:VCALENDAR"
    ]);
  }

  const calendar = Object.freeze({ googleCalendarUrl, icsContent, getUid: function (input) {
    return getUid(validateEvent(input));
  } });
  if (typeof module !== "undefined" && module.exports) module.exports = calendar;
  if (root) root.TeacherFlaviusLessonCalendar = calendar;
})(typeof window === "undefined" ? null : window);

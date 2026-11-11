const FROM = "Teacher Flávio <reservas@teacherflavius.com>";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function flexibleBookingEmail({ studentName, className, classDate, schedule,
  meetingUrl, materialUrl, recordingsUrl, calendarUrl }) {
  const links = [
    ["Google Meet", meetingUrl],
    ["Material didático", materialUrl],
    ["Aulas gravadas", recordingsUrl],
    ["Adicionar ao calendário", calendarUrl],
  ];
  if (links.some(([, url]) => !/^https:\/\//i.test(String(url || "")))) {
    throw new Error("Os links da reserva FLEXIVEL estão incompletos.");
  }
  const policy = "Você pode cancelar a reserva até o início da aula. "
    + "Se cancelar com pelo menos 12 horas de antecedência, o crédito utilizado "
    + "volta ao saldo FLEXÍVEL, dentro da validade da mensalidade. "
    + "Cancelamentos tardios e faltas não devolvem crédito.";
  return {
    from: FROM,
    subject: `Reserva FLEXIVEL confirmada — ${classDate}, ${schedule}`,
    text: [`Olá, ${studentName}!`, `Turma: ${className}`, `Data: ${classDate}`,
      `Horário de Brasília: ${schedule}`, policy,
      ...links.map(([label, url]) => `${label}: ${url}`),
      "Seus links atualizados também estão em https://teacherflavius.com/area-do-estudante/minhas-aulas/",
    ].join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:620px;margin:auto">
      <h1>Reserva FLEXIVEL confirmada</h1><p>Olá, ${escapeHtml(studentName)}!</p>
      <p><strong>${escapeHtml(className)}</strong><br>${escapeHtml(classDate)}<br>
      ${escapeHtml(schedule)} — horário de Brasília</p><p>${policy}</p>
      ${links.map(([label, url]) => `<p><a href="${escapeHtml(url)}">${label}</a></p>`).join("")}
      <p><a href="https://teacherflavius.com/area-do-estudante/minhas-aulas/">Consultar meus links atualizados</a></p></div>`,
  };
}

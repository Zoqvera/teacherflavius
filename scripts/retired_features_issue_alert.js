"use strict";

const ALERT_TITLE = "[Monitoramento] Regressão em recursos descontinuados";
const ALERT_MARKER = "<!-- teacherflavius-retired-features-incident -->";

function findOpenIncident(issues) {
  return issues.find(issue =>
    !issue.pull_request &&
    issue.title === ALERT_TITLE &&
    typeof issue.body === "string" &&
    issue.body.includes(ALERT_MARKER)
  );
}

function incidentBody(runUrl) {
  return [
    ALERT_MARKER,
    "## Falha na auditoria de produção",
    "",
    "O monitor de recursos descontinuados encontrou uma falha na última verificação.",
    "Confira os detalhes antes de tratar a ocorrência como regressão confirmada.",
    "",
    "- Áreas verificadas: Minha Semana, Planos Semanais e Portal de Exercícios legado.",
    "- Também são verificados cache, acesso anônimo ao catálogo antigo e páginas públicas.",
    `- Execução com falha: ${runUrl}`,
    "",
    "### Procedimento",
    "1. Examine o job de auditoria na execução acima.",
    "2. Diferencie falhas transitórias de rede de regressões reproduzíveis.",
    "3. Caso necessário, corrija o problema em PR com testes e preserve os dados acadêmicos.",
    "4. Execute novamente o monitor para validar a recuperação.",
    "",
    "Este chamado será encerrado automaticamente após uma auditoria bem-sucedida,",
    "sem criar duplicatas enquanto permanecer aberto.",
  ].join("\n");
}

async function synchronizeMonitorIssue({ github, owner, repo, outcome, runUrl }) {
  if (!["success", "failure"].includes(outcome)) {
    throw new Error("Resultado de auditoria inválido.");
  }
  if (!owner || !repo || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(runUrl)) {
    throw new Error("Contexto da execução inválido.");
  }

  const openIssues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const incident = findOpenIncident(openIssues);

  if (outcome === "failure") {
    if (incident) return "already-open";

    await github.rest.issues.create({
      owner,
      repo,
      title: ALERT_TITLE,
      body: incidentBody(runUrl),
    });
    return "opened";
  }

  if (!incident) return "healthy";

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: incident.number,
    body: `Recuperação confirmada pela auditoria de produção: ${runUrl}`,
  });
  await github.rest.issues.update({
    owner,
    repo,
    issue_number: incident.number,
    state: "closed",
    state_reason: "completed",
  });
  return "resolved";
}

module.exports = {
  ALERT_MARKER,
  ALERT_TITLE,
  findOpenIncident,
  synchronizeMonitorIssue,
};

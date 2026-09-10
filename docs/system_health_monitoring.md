# Monitoramento global de saúde do sistema

Data de implantação: 10 de setembro de 2026.

## Objetivo

O monitor global consolida sinais operacionais do TeacherFlavius.com sem substituir os mecanismos especializados existentes. O health financeiro continua responsável por integridade de pagamentos. O workflow externo `Production availability` continua verificando a produção a partir do GitHub. O monitor global adiciona uma visão interna, persistente e frequente da disponibilidade e dos principais sinais de falha.

A partir da etapa de qualidade de dados, o painel também recebe um bloco independente de `data_quality`. Esse bloco não altera o status global de disponibilidade: uma inconsistência cadastral pode exigir correção operacional sem significar que o site está indisponível.

## Arquitetura

O ciclo interno é executado a cada 5 minutos:

1. `private.dispatch_system_synthetic_probe()` chama a Edge Function `system-synthetic-probe` usando um segredo armazenado no Vault.
2. A Edge Function faz somente requisições GET às rotas públicas críticas, com timeout de 8 segundos.
3. Cada resultado é persistido em `private.system_synthetic_probe_results`.
4. A função executa `run_system_health_check_internal(true)`.
5. O scanner cruza probes, erros da aplicação, HTTP 5xx, autenticação, CSP e jobs agendados.
6. O resultado é persistido em `private.system_health_runs`.
7. Issues geram registros deduplicados em `private.system_health_alerts`.
8. Alertas novos são enviados por `notify-system-health-alert`, usando o mesmo segredo de webhook operacional e o Resend.

Um watchdog separado, `system-health-watchdog`, executa a cada 10 minutos. Ele detecta se o próprio health check global deixou de produzir resultados, detecta atraso do health check de qualidade de dados e também recoloca alertas falhados na fila, com limite de tentativas.

## Health check de qualidade dos dados

`private.run_operational_data_quality_check()` roda às `:12` e `:42` de cada hora e persiste o histórico em `private.operational_data_quality_runs` por 90 dias.

As invariantes monitoradas incluem:

- vínculos de turma órfãos ou com referência de sujeito inválida;
- turmas acima da capacidade operacional;
- tipo de turma do aluno incompatível com a turma ativa;
- aluno com tipo definido sem turma ativa;
- CPF duplicado entre alunos ativos;
- inconsistência entre `archived` e `archived_at`;
- turma ativa sem tipo/horário, exceto a turma operacional `INDETERMINADA`;
- reposição acima da capacidade, vinculada à turma incorreta ou com status/timestamp incoerentes;
- slot automático futuro ligado a turma inexistente/inativa;
- registro de lição com `class_number` inexistente;
- frequência com referência de sujeito inválida;
- mensalidade cujo `subject_ref` diverge do aluno;
- tentativa de pagamento cuja referência diverge da mensalidade.

Três classes são registradas apenas como métricas informativas porque podem representar histórico legítimo: vínculo de aluno arquivado a turma, configuração de cobrança ainda ativa para aluno arquivado e mais de um registro de lição para o mesmo aluno/encontro.

Findings inequívocos são classificados como `warning` ou `critical`. Alertas são deduplicados pelo código + conteúdo do finding. O health check não corrige registros automaticamente.

## Capacidade de turmas

A capacidade operacional foi centralizada em `private.get_class_operational_capacity(class_number)` para impedir divergência entre trigger, troca de turma e listagens de vagas.

A regra vigente é:

- `individual`: 1 aluno;
- `quartet`: 4 alunos;
- turmas 73 e 75: exceção comercial de 5 alunos;
- `eight_students`: 8 alunos.

A turma 48 voltou à capacidade padrão de quarteto. A mesma função central é utilizada no enforcement de `class_students`, nas listagens de vagas, na troca de turma e na reativação de aluno arquivado.

`class_students` também possui uma constraint garantindo exatamente uma referência de sujeito: `user_id` ou `invite_id`, nunca ambos e nunca nenhum.

## Probes sintéticos

Os alvos monitorados são:

- `home` — `https://teacherflavius.com/`;
- `health` — `https://teacherflavius.com/health.json`, incluindo validação do conteúdo JSON;
- `login` — `https://teacherflavius.com/login/`;
- `student_access` — `https://teacherflavius.com/acesso-aluno/`.

O monitor não cria usuários, não altera dados e não executa POST, PUT ou DELETE nessas rotas. O objetivo é confirmar disponibilidade HTTP e latência básica.

O resultado é considerado stale quando não há probe recente para um alvo esperado por mais de 12 minutos. Uma falha de um alvo gera `warning`; duas ou mais falhas simultâneas geram `critical`.

## Sinais e thresholds

O health check trabalha com janelas móveis de 15 minutos para evitar que erros históricos mantenham o sistema permanentemente degradado.

| Sinal | Warning | Critical |
| --- | --- | --- |
| erro com severidade `critical` | — | 1 ou mais |
| HTTP 5xx | 2–4 | 5 ou mais |
| falhas de autenticação | 5 ou mais | — |
| mesmo fingerprint de erro | 10–24 | 25 ou mais |
| falhas de recursos | 15 ou mais | — |
| CSP acionável | 10 ou mais | — |
| probes falhando | 1 alvo | 2 ou mais |
| probe stale/ausente | 1 ou mais | — |
| último status de cron `failed` | — | 1 ou mais |
| crons stale | 1 | 2 ou mais |

Os thresholds são operacionais, não métricas de produto. Eles devem ser recalibrados com dados reais se houver falso positivo recorrente ou uma classe de falha relevante abaixo do limiar.

## CSP

Os eventos continuam sendo armazenados integralmente em `public.csp_violation_reports`. Para cálculo de saúde, ocorrências cujo `blocked_uri` começa com `https://static.cloudflareinsights.com/` são atualmente classificadas como ruído conhecido do beacon do Cloudflare e não entram em `csp_actionable_15m`.

Essa exclusão é específica e deliberada. Outras origens bloqueadas continuam acionáveis. Se o comportamento do beacon mudar, a regra precisa ser reavaliada em vez de ampliar genericamente a allowlist.

## Jobs monitorados

O scanner acompanha os jobs operacionais existentes com tolerância coerente com a frequência de cada um:

- `mercado-pago-reconciliation` — 15 minutos;
- `payment-alert-health-scan` — 15 minutos;
- `payment-financial-health-check` — 15 minutos;
- `mercado-pago-chargeback-reconciliation` — 90 minutos;
- `operational-data-quality-health-check` — 90 minutos;
- `sync-auto-makeup-slots-30-days` — 26 horas;
- `daily-data-retention-maintenance` — 26 horas.

O dashboard também mostra o estado do `system-synthetic-probe` e do `system-health-watchdog`.

## Acesso e menor privilégio

As tabelas do monitor ficam no schema `private`. `anon` e `authenticated` não recebem grants diretos. As RPCs internas são exclusivamente `service_role`.

A interface administrativa chama `get-system-health-dashboard`, que exige JWT válido e `is_teacher_admin_mfa() = true`. Portanto, o navegador não recebe acesso às tabelas privadas nem às RPCs internas.

As Edge Functions chamadas pelo banco (`system-synthetic-probe` e `notify-system-health-alert`) não usam JWT porque são endpoints máquina-a-máquina. Ambas exigem `x-webhook-secret`, comparado em tempo constante com o segredo esperado.

## Painel administrativo

A página canônica é `/saude-do-sistema/`, marcada `noindex, nofollow`. Ela também é adicionada como aba `Saúde do sistema` em `/relatorios/` por `system_health_reports_integration.js`.

O painel mostra:

- estado global e quantidade de issues;
- estado independente de qualidade de dados e seus findings;
- contadores recentes de erro, HTTP 5xx e CSP acionável;
- última execução dos health checks;
- estado e latência dos probes;
- estado dos jobs monitorados;
- alertas operacionais recentes.

## Bootstrap e watchdog

Na primeira implantação, o watchdog executou antes do primeiro probe e gerou um alerta `system_health_stalled`. O alerta foi entregue e o sistema convergiu imediatamente para `healthy` após o primeiro probe real.

A migração `20260910030731_prevent_system_health_bootstrap_false_alert` adicionou uma janela de graça de 15 minutos somente quando ainda não existe nenhuma execução do health check e o monitor acabou de ser ativado. Isso impede falso positivo em uma reconstrução limpa sem mascarar uma parada posterior do monitor.

O watchdog também gera `data_quality_check_stalled` se não houver uma execução do health check de qualidade dos dados por mais de 90 minutos.

## Retenção

- probes sintéticos: 30 dias;
- execuções do health check global: 90 dias;
- execuções do health check de qualidade de dados: 90 dias;
- alertas entregues: 180 dias.

A retenção reduz crescimento indefinido das tabelas sem remover dados recentes necessários para investigação operacional.

## Resposta a incidentes

Quando o estado global ficar `degraded` ou `critical`, use esta ordem:

1. confirme se o último health check é recente;
2. veja quais invariantes operacionais estão ativas;
3. confirme os quatro probes e suas latências;
4. verifique jobs com falha ou atraso;
5. para erros de aplicação, abra `Monitoramento de erros` e filtre pelo período/fingerprint;
6. para pagamentos, use o health financeiro e o dashboard de mensalidades, que continuam sendo a fonte especializada;
7. não reexecute efeitos financeiros apenas porque o health global acusou uma falha;
8. depois da correção, exija uma nova execução `healthy` com `issue_count = 0`.

Para um finding de qualidade de dados, confirme primeiro qual registro/regra está inconsistente e corrija a causa por um fluxo administrativo existente. Não faça autocorreção em massa com base apenas no contador do health check.

Um alerta isolado não deve ser apagado para “limpar o painel”. Preserve o histórico e corrija a causa ou o threshold quando necessário.

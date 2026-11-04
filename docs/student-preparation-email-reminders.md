# Lembretes pedagógicos individuais — preparação da próxima aula

## Objetivo
Enviar automaticamente **somente aos alunos com pendências**, na véspera da aula regular,
um e-mail de `pedagogico@teacherflavius.com`. O envio administrativo existente,
`notify-pedagogical-preparation`, permanece independente.

## Regras
- Verificação a cada 5 minutos, com geração de lembretes **a partir das 18h de Brasília,
  exclusivamente para aulas do dia seguinte**. O agendamento usa a data local
  `America/Sao_Paulo`; uma entrada por aluno/turma/aula.
- Apenas matrícula ativa, aluno não arquivado, vínculo vigente e turma ativa;
  respeitar datas da primeira aula, calendário da turma e cancelamentos não restaurados.
- Apresentação pendente se a próxima lição acadêmica não tem texto não vazio.
- Perguntas pendentes quando menos de cinco **perguntas distintas** receberam
  o registro de ESTUDEI A PERGUNTA desde a última ocorrência de aula registrada
  (ou desde a entrada na turma para quem ainda não teve aula).
- Enviar se **qualquer uma** das duas atividades estiver pendente. Exibir só as
  pendências existentes e, para perguntas, mostrar quantidade já estudada e restante.
- Revalidar o estado acadêmico no momento do envio. Suprimir envio se o aluno
  se preparou, foi arquivado, transferido, desvinculado ou teve a aula cancelada.
- O destinatário é somente o e-mail cadastrado do aluno; alunos sem e-mail
  válido não entram na fila.
- Não enviar duas vezes para a mesma aula: chave única na fila, claim condicional
  e chave de idempotência fixa no Resend.
- `sent` significa aceitação pela API de envio, não comprovação de leitura
  ou entrega na caixa de entrada.

## Componentes
- Migration: `supabase/migrations/20261104040000_student_preparation_email_reminders.sql`.
- RPC restrita a `service_role`: `student_preparation_email_context_internal`.
- Edge Function: `notify-student-preparation`; webhook autenticado pelo
  segredo compartilhado já utilizado nas notificações administrativas.
- Outbox sob RLS: `student_preparation_email_reminders`. Nunca armazena
  contato, texto da lição ou conteúdo das perguntas.
- `student_preparation_email_settings.enabled` inicia **false** e é o
  interruptor central para pausar ou liberar os envios.
- Job `student-preparation-email-reminders`, com execução a cada cinco minutos
  e bloqueio de envio antes das 18h. Não modifica o job de alertas do professor.

## Plano de verificação
1. Validar SQL com `BEGIN ... ROLLBACK` e testes de contrato.
2. Conferir casos de apresentação/poucas perguntas/ambas/completo.
3. Conferir aula cancelada, turma transferida, matrícula futura e arquivamento.
4. Publicar função e verificar configuração do Resend, domínio remetente e
   segredo de invocação (sem enviar e-mail real para terceiros em homologação).
5. Habilitar `enabled=true` somente após aprovação técnica.

## SEO
Nenhuma alteração em páginas públicas, URLs, sitemap, metadados ou indexação.

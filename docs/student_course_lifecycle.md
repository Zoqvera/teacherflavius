# Situação administrativa de alunos: matrícula, turma e cobrança

## Conceitos

**Matrícula** é a relação do aluno com o curso. **Turma** é a alocação em um horário. **Cobrança** representa a configuração comercial, que pode estar ativa, pausada ou isenta independentemente do vínculo de turma.

A categoria contratual `INDIVIDUAL` / `QUINTETO` permanece em `profiles.class_type` e NÃO equivale a um estado administrativo.

`public.student_course_states` registra:

- `active`: vínculo com turma regular ativa; cobrança normal, salvo isenção.
- `awaiting_class`: matrícula mantida sem alocação; cobrança contratual preservada e pode ser devida.
- `paused`: matrícula preservada sem turma; geração de novas mensalidades suspensa.
- `billing_exemption = permanent`: isenção financeira independente da situação de turma.

Alunos sem linha explícita na tabela recebem estado derivado pela RPC `get_teacher_student_course_states`, conforme o vínculo regular ativo. A tabela está protegida por RLS (somente professores administradores) e as RPCs verificam `is_teacher_admin()`.

## Transições

- O professor usa **Perfil dos Alunos > Alterar situação** para indicar pausa, aguardo e isenção com motivo.
- Ao remover o último vínculo regular em **Turma**, deve escolher entre manter aguardando com cobrança, pausar ou arquivar.
- Na ausência de uma escolha administrativa explícita (ex.: remoção por outra interface), o trigger define `awaiting_class` e preserva a cobrança, evitando suspensões financeiras silenciosas.
- Ao vincular um aluno pausado a uma turma regular ativa, o trigger marca `active` e reativa cobrança somente se não for isento. O `billing_start_month` é avançado para o mês do próximo vencimento após a retomada, sem gerar cobranças retroativas referentes ao período de pausa.
- Ao vincular aluno `awaiting_class`, o estado se torna `active` e a cobrança previamente existente não é alterada.
- O arquivamento continua sendo operação separada, com desvinculação de turma e desligamento da cobrança conforme o fluxo preexistente.

## Proteções financeiras

- Um aluno pausado ou com isenção permanente não pode ter a cobrança ativada inadvertidamente em `student_billing_settings`.
- O trigger de `monthly_tuition` impede a criação de mensalidades não isentas para beneficiários de isenção permanente, ou mensalidades a partir da competência bloqueada na pausa.
- Alterar o estado administrativo **não** elimina pagamentos, competências antigas, estornos, isenções de mensalidades anteriores nem vencimentos já emitidos.
- Se existir cobrança em aberto para o mês corrente quando o professor decidir pausar, ela exige análise específica, não é cancelada automaticamente.
- O retorno da pausa usa o primeiro vencimento posterior à retomada. Verificar a configuração de dia/valor antes de confirmar a nova matrícula em turma.

## Dados revisados em 12/10/2026

- Elaine Moreira: aguardando turma, cobrança de outubro mantida.
- Marcos Ismeiro da Silva: aguardando turma, primeira mensalidade mantida.
- Maria Luiza Aleixo Lemos: pausada por viagem; sem cobrança gerada a partir de outubro/2026 até uma nova alocação. A data histórica exata de desvinculação não era verificável; o banco preserva `status_since = null`, sem inventar data.
- Natanael Albino: matriculado com turma, isenção permanente registrada e cobrança desativada.

## Auditoria operacional

`private.run_operational_data_quality_check` mantém alunos aguardando turma como informação, não como alerta. As novas métricas informativas distinguem pausas e isenções. Um alerta é emitido apenas quando há:

- cobrança ativa em estado pausado ou permanentemente isento;
- cobrança desativada sem pausa ou isenção cadastrada;
- estado administrativo incompatível com vínculo regular existente.

As invariantes não apagam dados. A interface administrativa mantém `noindex`; estas alterações não modificam SEO de páginas públicas.

## Reversão operacional

Antes de remover as estruturas, desabilitar triggers e preservar cópia dos estados. Não reativar cobrança em lote: conferir motivos de suspensão e competência inicial individualmente. Histórico financeiro nunca deve ser descartado.

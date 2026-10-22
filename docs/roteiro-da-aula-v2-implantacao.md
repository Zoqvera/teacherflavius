# Roteiro da Aula v2 — implantação sem interrupção

## Premissa de compatibilidade

A rota de produção `/roteiro-da-aula/` permanece como está, com todas as
funcionalidades atuais. A nova experiência foi introduzida em
`/roteiro-da-aula-v2/`, sem links em menus ou na página atual, com
`noindex, nofollow` e autenticação administrativa obrigatória.

A rota v2 não está liberada para uso operacional. Os controles de registro
de apresentações e avaliações aparecem desabilitados até a conclusão
das próximas etapas. Nenhum RPC de escrita é invocado pelo novo módulo.
A página atual continua sendo a única interface autorizada para registrar aulas.

## Etapa 1 — concluída nesta PR

- Dois cards: APRESENTAÇÕES DO DIA e PERGUNTAS DO DIA.
- Navegação por data, turmas do dia e alunos de cada turma.
- Separação completa das visualizações de apresentação e perguntas.
- Alunos com aula cancelada exibidos em seção própria.
- Seções de perguntas: estudadas para hoje, a revisar e todas as estudadas.
- Conteúdo das perguntas anteriores obtido pelo catálogo, sem modificar
  o histórico pedagógico original.
- Prévia somente para leitura e exclusivamente para o professor.
- Testes de agrupamento, visibilidade dos cancelamentos e isolamento.

## Etapa 2 — registro persistente de apresentações (implementação preparada)

- Conferido na função existente `mark_teacher_lesson_presented` que o banco
  sincroniza a frequência como `present`, insere registro em
  `class_lesson_records`, marca conclusão em `study_roadmap_completion` e
  registra `presented_lesson_number` numa única transação.
- `roteiro-da-aula-v2/presentation_registration.js` valida tipo da aula,
  identificadores, apresentação planejada, situação da frequência e dia
  civil de São Paulo antes de invocar a operação já existente.
- Chamadas simultâneas para a mesma apresentação compartilham a mesma
  requisição. Uma confirmação positiva é memorizada na sessão para impedir
  um segundo envio enquanto a interface atualiza.
- O retorno da RPC deve confirmar `ok`, `occurrence_id` e o número da
  apresentação. Erros não são mostrados como sucesso e são recuperáveis.
- A tela de apresentações contém o botão único acima do texto; quando
  ativado, ele fica indisponível enquanto salva e, após confirmação,
  mostra `APRESENTAÇÃO REGISTRADA` e presença confirmada.
- **A liberação segue bloqueada** por
  `PRESENTATION_REGISTRATION_ENABLED = false` até todas as etapas e testes
  de integração terminarem. Nenhum registro desta prévia é executado em
  produção enquanto a chave permanece desativada. O roteiro atual continua
  sendo a interface operacional.
- Os testes da Etapa 2 usam serviços simulados; não escreveram em
  registros de alunos reais.

**Ajustes posteriores:** correção administrativa auditável e verificação
integrada de duplicidade/concorrência em banco após homologação, antes da
ativação definitiva.

## Etapa 3 — avaliações de perguntas (implementação preparada)

- Serviço separado em `roteiro-da-aula-v2/question_ratings.js`: valida
  pergunta estudada ou de revisão, tipo/identificador da aula, frequência,
  cancelamentos e data local; controla cliques concorrentes e confirma o
  retorno da RPC antes de marcar a avaliação como registrada.
- `rate_teacher_conversation_question_v2`: nova RPC aditiva com acesso
  administrativo obrigatório. Sincroniza a presença como `present` e
  avalia a pergunta em uma única transação PostgreSQL. Se a avaliação
  falhar, a presença é revertida. Reutiliza os intervalos de revisão
  `good=5`, `medium=3`, `improve=1` já existentes.
- Uma pergunta já avaliada na mesma ocorrência não é reavaliada por esta
  nova RPC; concorrência por pergunta é serializada. O histórico por
  ocorrência continua preservado em
  `private.conversation_question_practice_log`. Correção auditável de
  uma avaliação feita por engano será tratada separadamente antes da
  ativação, não por novo clique silencioso.
- `get_teacher_question_rating_history_v2`: consulta somente de leitura,
  limitada às turmas da data pedida e à conta do professor. Recupera
  avaliações anteriores e identifica as realizadas na ocorrência atual.
  A Data API não recebe acesso direto à tabela privada.
- Interface: BOTÕES BOM/MÉDIO/MELHORAR em perguntas estudadas para hoje
  ou previstas para revisão, identificação da última avaliação e seção
  TODAS AS PERGUNTAS ESTUDADAS com busca. Estado de expansão das seções
  é preservado após atualização na mesma sessão.
- Quando a migração ainda não estiver disponível, a prévia indica
  histórico indisponível e mantém as operações desativadas.
- **Liberação bloqueada:** `QUESTION_RATINGS_ENABLED = false`.
  `PRESENTATION_REGISTRATION_ENABLED` também permanece `false`.
  A migração foi versionada no repositório; não foi executada
  manualmente em alunos ou registros da produção nesta etapa.
- Testes abrangem validação de permissão, cancelamentos, datas,
  avaliações anteriores, chamadas concorrentes, retorno da RPC e
  recuperação após falha.

O Roteiro da Aula atual não foi modificado e continua operativo.

## Etapa 4 — frequência e encerramento (implementação preparada)

- Nova migração aditiva `20261022212500_academic_v2_auto_attendance_and_closure.sql`,
  sem substituir `get_teacher_lesson_plan`, `finalize_teacher_lesson_session`
  ou qualquer rotina do ROTEIRO DA AULA atual.
- Worker `private.run_teacher_v2_auto_finalizations()` calcula
  `starts_at + interval '90 minutes'` no servidor, percorre aulas regulares
  e reposições confirmadas, protege-se contra chamadas concorrentes e marca
  como ausentes somente os alunos sem presença, apresentação, avaliação ou
  participação excepcional. Registros de presença existentes são preservados.
- Cancelamentos permanecem `cancelled` e não geram ausência ou movimentação
  de créditos. A rotina não altera regras de mensalidade nem matrícula.
- O encerramento utiliza a tabela existente
  `private.academic_class_session_finalizations` e guarda um instantâneo
  nominal em `private.academic_v2_closed_session_snapshots`.
- Histórico consultável pela nova RPC
  `get_teacher_v2_closed_sessions`, com permissão apenas do professor.
  Corrigir uma frequência posteriormente atualiza o histórico consultado,
  mantendo o instantâneo de encerramento para auditoria.
- `mark_teacher_v2_participation` confirma presença excepcional, separada
  de apresentações e avaliações.
- `correct_teacher_v2_attendance` permite corrigir presença/ausência
  com justificativa de 8 a 500 caracteres; a tabela privada
  `academic_v2_attendance_audit` registra valores anteriores, motivo,
  horário e administrador. A regra existente impede ausência em aulas com
  conteúdo pedagógico registrado.
- O agendamento `teacher-v2-auto-finalize` está preparado para executar a
  cada minuto, mas o controle no servidor
  `private.academic_v2_automation_control.enabled` nasce **false**.
  Nenhuma aula é encerrada automaticamente antes da ativação expressa na
  Etapa 5; `enabled_from` delimita as novas ocorrências, impedindo
  processamento retroativo de aulas anteriores.
- No cliente, `SESSION_LIFECYCLE_ENABLED = false`, assim como os gates de
  apresentações e perguntas. A nova interface mostra turmas encerradas
  em modo de consulta; os botões de participação/correção ficam desativados.
  O roteiro atual segue sendo a interface operacional.
- Verificações automatizadas cobrem o limiar de 90 minutos, cancelamentos,
  gate inicialmente desligado, histórico, autorização, auditoria e erros.
  **Não foram efetuadas escritas em dados reais de alunos nesta etapa.**

### Condições obrigatórias para ativar na Etapa 5

1. Aplicar migrações pendentes em ambiente de homologação e executar testes
   de integração com sessões simuladas, incluindo cancelamentos e viradas de dia.
2. Conferir as regras de créditos, arquivos e primeira aula, sem efeitos sobre
   lançamentos financeiros e frequência histórica.
3. Validar concorrência de avaliação/apresentação com fechamento e recuperação
   após indisponibilidade do cron.
4. Habilitar os módulos da interface e o worker do servidor na mesma janela
   de publicação, definindo `enabled_from` para a ativação em diante.
5. Testar a leitura de turmas antigas finalizadas manualmente, notificações
   de erro e correções administrativas.

Nenhum passo desta etapa autoriza ativar o agendamento para aulas reais.

## Etapa 5 — homologação e troca controlada

Testar as turmas quinteto e individuais, aulas de reposição, cancelamentos,
virada de dia, aulas remarcadas e histórico anterior. Verificar pipelines,
permissões, responsividade e auditoria. Somente após a homologação, trocar
a rota de entrada mantendo um caminho de retorno para a versão antiga.

## SEO

A prévia usa `noindex, nofollow`, não modifica `sitemap.xml`,
URLs públicas indexáveis nem a página operacional existente.
O eventual redirecionamento ou troca de rota será tratado separadamente
e comunicado antes da alteração.

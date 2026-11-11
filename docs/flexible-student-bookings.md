# Modalidade FLEXIVEL

A modalidade de vínculo fica em `private.flexible_students`, independente do tipo
pedagógico do perfil. Só o professor pode alterá-la, em Editar aluno, ou pela RPC
`set_teacher_student_booking_mode(student_id, 'FLEXIVEL')` em sessão administrativa.
Nenhum aluno existente é convertido pela implantação.

Para ativar, o aluno deve estar matriculado e ativo, sem vínculo fixo e sem créditos
futuros já agendados. A função recusa a conversão se houver aulas que precisem de
conciliação: não descarta créditos pagos nem remove vínculos silenciosamente.
Para voltar a uma turma permanente, selecionar FIXO primeiro. Reservas existentes
continuam definitivas e visíveis enquanto o aluno usar a modalidade FLEXIVEL.

## Regras

- Uma aula por semana da ocorrência, de segunda a domingo em America/Sao_Paulo.
- Janela de 14 datas, com antecedência mínima de uma hora.
- Vagas permanentes e vagas explicitamente liberadas por cancelamento compartilham
  o mesmo estoque com reposições. Reservas usam a mesma linha da turma como lock.
- Reservas aceitam créditos contratuais livres de mensalidades pagas ou isentas
  e créditos concedidos manualmente pelo professor (`manual_grant`), mesmo que a
  mensalidade associada ainda não esteja quitada. Todos precisam estar disponíveis,
  não revogados, sem reserva anterior e dentro da vigência do ciclo da mensalidade.
  Créditos contratuais têm prioridade sobre manuais dentro do mesmo ciclo;
  créditos de reposição não são elegíveis.
- O crédito é consumido na transação da reserva; índice único e lock por aluno
  impedem reservas duplicadas na semana e cliques concorrentes.
- O aluno pode cancelar uma reserva confirmada até o início da aula em MINHAS AULAS.
  Com antecedência mínima de 12 horas, o crédito de aula utilizado retorna ao saldo
  FLEXIVEL, dentro da vigência original da mensalidade. O cancelamento tardio libera
  a vaga, mas consome definitivamente o crédito; faltas também não devolvem crédito.
  Reservas não podem ser editadas ou excluídas. A operação tem validação de
  propriedade, limite temporal e idempotência no banco; RPCs legadas continuam
  inacessíveis para o aluno. O professor pode cancelar e devolver um crédito válido.
- FLEXIVEL não pode adquirir turma permanente sem mudança administrativa para FIXO.
- Turmas regulares individuais e quintetos são elegíveis. Aulas experimentais têm
  fluxo próprio. Exigem Meet, material e gravações com HTTPS configurados.
- Não há filtro por nível: as turmas ainda não possuem um cadastro canônico de nível.
  Não foi inventada uma classificação para as turmas existentes.
- A validade segue a cobertura financeira existente; não há acúmulo entre ciclos
  nem transferência automática por indisponibilidade de vagas nesta versão.

## E-mail

A fila transacional existente processa as confirmações, com retry limitado e chave
idempotente. O aluno recebe de `reservas@teacherflavius.com`, com resposta para
`contato@teacherflavius.com`, os três links, data e horário de Brasília, aviso de
regra de cancelamento (12 horas) e calendário. Links são consultados novamente no envio e em
MINHAS AULAS. A pasta de gravações concede o acesso configurado pelo professor.
Alterar links depois do envio atualiza a página, mas não dispara aviso automático
nesta versão. Não é enviada mensagem externa durante testes SQL: rollback cancela
as requisições pg_net pendentes.

## Validação

`tests/sql/flexible_booking_homologation.sql` testa a reserva e fila, limite semanal,
bloqueio das rotas antigas, autorização administrativa, devolução por cancelamento
do aluno e do professor. Executa somente com rollback. Testes Node cobrem interface e envio
simulado completo do e-mail; não comprovam entrega real na caixa postal.

Não altera conteúdo público, sitemap, robots ou configurações de SEO.

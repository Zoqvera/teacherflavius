# Reposição por modalidade de matrícula

O fluxo de **Minhas Aulas** utiliza exclusivamente os procedimentos
`get_my_replacement_options` e `book_my_lesson_replacement`. O tipo da turma
de destino é determinado pelo plano ativo do aluno, sem confiar na categoria
informada pelo navegador.

- **INDIVIDUAL**: apenas turmas INDIVIDUAL. O crédito deve ter origem
  `contract`, resultar de cancelamento de aula regular e ter sido concedido
  conforme a antecedência contratual de 12 horas. Créditos manuais não
  habilitam reposições INDIVIDUAL.
- **QUINTETO**: apenas turmas QUINTETO. A política de crédito já existente
  permanece válida, inclusive créditos manuais concedidos pelo professor.
- **Vagas**: INDIVIDUAL permite agendamento somente se a sessão tiver uma
  vaga real, inclusive a vaga liberada pelo cancelamento do aluno regular.
  QUINTETO mantém a condição de pelo menos quatro vagas ou uma vaga
  liberada por cancelamento. Os dois formatos mantêm a regra de não
  reagendar na turma atual nem no dia de aulas regulares do aluno.

Os horários disponíveis respeitam a agenda configurada na turma e exigem
link de aula válido; aulas sem link não são publicadas como opção. A confirmação
revalida crédito, modalidade, horário e lotação dentro da transação.

Os procedimentos antigos de agendamento sem crédito permanecem inacessíveis
aos perfis estudantis. Matrículas existentes, cobranças e agendamentos
anteriores não são alterados.

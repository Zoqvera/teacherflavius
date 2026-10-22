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

## Etapa 2 — registro persistente de apresentações

Implementar REGISTRAR APRESENTAÇÃO usando a transação existente
`mark_teacher_lesson_presented`, após conferir se o backend consegue
inferir presença com segurança. Manter idempotência, prevenção de cliques
duplicados, atualização da próxima apresentação e possibilidade de correção
administrativa auditável. Nunca usar o texto enviado como indicador de
apresentação concluída.

## Etapa 3 — avaliações de perguntas

Habilitar BOM/MÉDIO/MELHORAR em perguntas estudadas para hoje e em revisão.
Manter histórico completo de avaliações por aula e atualizações imediatas.
Definir a consulta histórica que preserve perguntas já estudadas mas ainda
não avaliadas e o algoritmo de revisões espaçadas.

## Etapa 4 — frequência e encerramento automáticos

Preparar migração e testes de integração para:
- Presença ao registrar apresentação, avaliação ou participação excepcional.
- Ausência apenas ao encerrar a ocorrência sem qualquer atividade registrada.
- Cancelamentos preservados, sem gerar ausência ou alterar créditos existentes.
- Finalização automática em `starts_at + interval '90 minutes'`, no servidor.
- Recuperação administrativa, reprocessamento idempotente e auditoria.
- Histórico acessível após finalizar, sem depender da RPC atual que oculta
  turmas finalizadas.

Estas mudanças só poderão ser aplicadas depois de verificar o contrato das
RPCs atuais e a rotina de cron: uma migração prematura alteraria os registros
do roteiro de produção.

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

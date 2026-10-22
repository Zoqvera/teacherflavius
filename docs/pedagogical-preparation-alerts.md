# Acompanhamento pedagógico por e-mail

## Escopo
E-mail administrativo para contato@teacherflavius.com, assunto exato "Acompanhamento pedagógico", quando aluno com aula regular próxima não tem texto da lição atribuída e/ou não marcou nova pergunta estudada desde a última aula.

Remetente técnico: pedagogico@teacherflavius.com (sem acento, interoperável no SMTP). Nome de exibição: Acompanhamento Pedagógico.

## Critérios
- Turma ativa e aluno vinculado, matriculado e não arquivado.
- A data da aula obedece dia da semana, horário e primeira aula do vínculo e da turma.
- Não incluir aulas canceladas, exceto quando uma restauração já estiver registrada.
- Somente alunos com ocorrência anterior registrada no histórico acadêmico. Não notificar na primeira aula.
- Para o texto: consultar a lição seguinte após a última lição efetivamente apresentada. Texto não vazio é suficiente, mesmo se salvo antes da aula anterior.
- Para perguntas: consultar a data original do clique em ESTUDEI A PERGUNTA. Contar somente cliques posteriores à última ocorrência de aula; exercícios avaliados pelo professor não contam.
- Sinalizar qualquer uma das duas pendências. Mostrar apenas as pendências existentes.
- Agrupar alunos de uma turma em um único e-mail; deduplicar por turma e início da aula.
- Agendar verificação a cada cinco minutos, com janela entre seis horas e seis horas e quarenta minutos antes da aula. Worker deve bloquear envios quando faltar menos de seis horas.
- Repetição limitada com chave de idempotência fixa do Resend.
- A fila não armazena contatos, textos ou conteúdo de perguntas. Dados de contato vêm de leitura autorizada no momento do envio.

## Componentes
- Migration de fila no esquema public, com RLS ativo e permissões de service role.
- Funções privadas para detectar pendências, enfileirar um alerta consolidado e solicitar o envio.
- Agendamento de cinco minutos no pg_cron e chamada pg_net da Edge Function.
- Edge Function do Resend autenticada por segredo compartilhado do Vault; API Resend e segredo já utilizados por notificações administrativas existentes.

## Publicação
1. Executar testes de contrato e testes de sintaxe.
2. Homologar SQL em cópia isolada e conciliar o histórico de migrações; não fazer push indiscriminado do diretório de migrations.
3. Publicar Edge Function com autenticação própria por segredo (não aceitar chamadas arbitrárias).
4. Verificar domínio remetente, Resend API, segredo webhook e chave de serviço do Supabase.
5. Verificar em simulação os casos de lição sem texto, perguntas sem estudo, ambas as pendências, cancelamento, aluno arquivado e aulas iniciais.
6. Ativar o agendamento e confirmar transições de status e entrega ao contato administrativo.

## SEO
Não há alteração de páginas públicas, indexação, urls, sitemap, canonical ou metadados.

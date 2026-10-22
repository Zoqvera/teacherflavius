# Descontinuação da Integração Google Forms — 21/10/2026

## Decisão

A integração legada que trazia respostas de exercícios do Google Forms foi
descontinuada. Não confundir com Google OAuth, Google Meet, Google Calendar,
Google Drive nem com as funcionalidades atuais de lições, Conversation Questions
e Tarefas para Casa.

## Intervenções

1. O botão `INTEGRAÇÃO GOOGLE FORMS` saiu da Área do Professor; o JavaScript
   também o remove de menus antigos em cache.
2. A rota `/integracao-google-forms/` exibe somente um aviso estático, mantendo
   o `noindex,nofollow` e o título SEO que já existia.
3. As Edge Functions `google-forms-exercise-sync` e
   `google-forms-integration-manager` retornam `410 Gone` para toda requisição,
   sem acessar o banco de dados e sem processar envios.
4. A migração `20261022014603_retire_google_forms_integration_20261021.sql`
   revoga execução das três RPCs administrativas de escrita e altera os estados
   das conexões para `disconnected` **apenas no Supabase**.

## Preservação

A migração não elimina linhas de `daily_exercise_completion`,
`exercise_sync_events`, `exercise_form_sources`, `teacher_exercises`
ou planilhas mantidas no Google. O painel histórico de exercícios permanece
fora desta descontinuação.

## Pendência externa: Google Apps Script

Os gatilhos instaláveis estão na conta Google proprietária do projeto
Apps Script. A interrupção do backend **não remove esses gatilhos**.
É necessário acessar `https://script.google.com/home/triggers` com a conta
que criou o script e excluir os gatilhos de envio de formulário e de verificação
de conexões. Se não forem removidos, continuarão executando e receberão HTTP
410, sem importar novas conclusões. Apagar os gatilhos não apaga dados históricos.

## SEO e publicação

Sem alterações em `robots.txt`, `sitemap.xml`, canonicals, textos comerciais
ou políticas de indexação. A página administrativa já tinha `noindex,nofollow`.
Somente o conteúdo operacional dessa rota foi substituído.

## Verificação

Conferir estado das funções publicadas, permissões das RPCs e estados de
`exercise_form_sources` após a implantação. Repetir os testes automatizados
`tests/google_forms_integration_retirement.test.js`.

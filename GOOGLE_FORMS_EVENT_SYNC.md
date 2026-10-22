> **DESCONTINUADO em 21/10/2026.** Este documento é apenas histórico. Os endpoints
> `google-forms-exercise-sync` e `google-forms-integration-manager` retornam HTTP 410,
> e as RPCs administrativas foram revogadas. Não execute as etapas de implantação
> abaixo nem configure novos gatilhos. Os gatilhos existentes no Google Apps Script
> devem ser removidos separadamente na conta que os criou.

# Sincronização automática de exercícios via Google Forms

Esta integração registra automaticamente em `daily_exercise_completion` as respostas recebidas em planilhas do Google Forms.

## Arquitetura

Google Forms → Google Sheets → gatilho instalável do Google Apps Script → Supabase Edge Function → `daily_exercise_completion`.

A data/hora usada em `completed_at` é a data/hora original da resposta do Google Forms. Se o mesmo aluno responder novamente, o backend preserva a realização mais antiga já registrada.

## Segurança

- A Edge Function usa um segredo compartilhado de alta entropia.
- O repositório armazena apenas o SHA-256 do segredo.
- O segredo bruto deve existir somente nas Script Properties do projeto Google Apps Script.
- A função usa a Service Role apenas no servidor; nenhuma chave administrativa é enviada ao navegador ou ao Google Sheets.
- E-mails sem correspondência segura não são atribuídos a outro aluno.

## Backend

A função está em:

`supabase/functions/google-forms-exercise-sync/index.ts`

Ela recebe:

- `exercise_id`
- `email`
- `completed_at`
- `event_key`

O backend valida o exercício, procura o aluno pelo e-mail, verifica se está matriculado e faz `upsert` em `daily_exercise_completion`.

## Google Apps Script

Use um único projeto independente do Google Apps Script para todas as planilhas. O projeto precisa de uma Script Property chamada:

`EXERCISE_SYNC_SECRET`

O código do Apps Script contém uma função `registerSpreadsheet(spreadsheetId, exerciseId)`. Cada nova atividade precisa ser registrada uma única vez. Depois disso, o gatilho de envio de formulário envia automaticamente as respostas futuras.

Há também uma rotina de backfill para processar respostas que já existiam antes da instalação.

## Atividades já preparadas

- Atividade 10 — planilha `1yoUK91aWgj7dUY1wnXEeaGzS3C6eyVO-WtjBe_VkPqg`
- Atividade 11 — planilha `1MPV0A1WUrCt3WeBP_xeBN8yJpkBIj_itlwouIJstWCo`

## Implantação

1. Implantar a Edge Function `google-forms-exercise-sync` com verificação JWT desabilitada, porque ela usa autenticação própria pelo segredo compartilhado.
2. Criar um projeto independente no Google Apps Script e colar o script da integração.
3. Criar a Script Property `EXERCISE_SYNC_SECRET`.
4. Executar `testExerciseSyncConnection()` e autorizar o Apps Script.
5. Executar `registerKnownActivities()` para instalar os gatilhos das Atividades 10 e 11.
6. Executar `syncKnownHistoricalResponses()` uma vez para importar as respostas históricas dessas duas atividades.
7. Para cada atividade nova, executar `registerSpreadsheet(ID_DA_PLANILHA, EXERCISE_ID)` uma única vez.

## Comportamento esperado

- aluno matriculado + e-mail correspondente → conclusão registrada;
- aluno já registrado na atividade → preserva a primeira data/hora;
- e-mail conhecido como alias → associado ao cadastro atual;
- e-mail desconhecido → resposta ignorada, sem associação arriscada;
- usuário não matriculado → resposta ignorada;
- `exercise_id` inexistente → resposta rejeitada.

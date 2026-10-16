# ETAPA 9.6.4 — Numeração fixa de Conversation Questions

## Motivo

A experiência nova filtrava do plano as perguntas com `marked_studied=true` e renumerava cada cartão com o índice da lista filtrada. Por exemplo, depois de estudar a pergunta 1, a pergunta 2 aparecia incorretamente como número 1.

## Fonte de verdade

`public.conversation_questions.display_order` contém a numeração imutável do catálogo para exibição. No momento da auditoria, o banco possuía 154 posições únicas, de 1 a 154, sem lacunas. Os primeiros registros eram:

- 1 — How are you?
- 2 — Where are you from?
- 3 — Where do you live?

O `AcademicWorkflowService` já carrega `display_order` das perguntas pendentes e das revisões. Por isso, não foi preciso criar migrações nem modificar os registros acadêmicos.

## Comportamento

- Segunda parte da experiência nova: cada cartão exibe `display_order`, inclusive nas perguntas para revisão.
- Após **ESTUDEI A PERGUNTA**, o registro atual no Supabase e o pop-up **Great job!** são preservados. Apenas o cartão marcado desaparece das pendentes.
- As perguntas remanescentes mantêm seus números originais, ainda que a primeira pendente seja a 8 ou a 12.
- Resposta do backend sem `display_order` válido não recebe numeração inventada; as posições oficiais só podem vir do catálogo.
- Experiência antiga de O QUE FAZER mantém a lógica de numeração que já utilizava, sem mudanças para alunos não participantes.

## Testes

- Testes funcionais com três perguntas identificadas como 1, 2 e 12 e clique sequencial nas duas primeiras.
- Confirmação de que o pop-up abre e que o contador de pendentes diminui sem renumerar os cartões.
- Regressão: numeração antiga continua sequencial quando a nova experiência está desabilitada.
- Chromium com cenário de filtro de perguntas e conferência dos números de cartões pendentes e revisões.
- Cache-busting do controlador JS nas duas páginas de O QUE FAZER.

## SEO

Nenhuma mudança de conteúdo indexável, canonical, robots.txt, sitemap ou endereço público. A página da segunda parte mantém `noindex,nofollow`.

## Próxima etapa

**ETAPA 9.6.5 — Homologação da Numeração Fixa com Oivalf**, após integração, testes e confirmação do build no Cloudflare.

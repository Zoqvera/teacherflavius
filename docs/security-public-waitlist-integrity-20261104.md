# Etapa 3 — Proteção da lista pública de espera

Data: 04/11/2026. Projeto Supabase: `wnigzpvgsbpjdxvjzugt`.

## Problema verificado

As duas variantes de `public.join_public_class_seat_waitlist` estão
corretamente restritas a turmas ativas de grupo e normalizam o telefone,
mas usam `ON CONFLICT DO UPDATE` sobre a chave
`(class_number, normalized_phone)`. Isso permite que qualquer visitante
com conhecimento do número sobrescreva o nome/WhatsApp de um lead
pré-existente e altere um lead `resolved` de volta para `waiting`.
O esquema privado não concede leitura ou escrita direta a visitantes,
mas as RPCs são intencionalmente públicas e `SECURITY DEFINER`.

## Alteração proposta, ainda não aplicada em produção

A migração `20261104022500_prevent_unauthenticated_waitlist_rewrites.sql`
substitui o conflito de ambas as variantes por `DO NOTHING`. A primeira
inscrição permanece válida; novas inscrições com o mesmo telefone/turma
são idempotentes, sem reescrever nome, WhatsApp ou estado.

Não há mudanças na rota `/escolher-turma/`, em matrícula, cobrança,
código de autenticação, permissões de tabela ou busca de vagas.
Os dados existentes não são modificados. Para reativar um lead marcado
`resolved`, o professor deverá realizar uma ação administrativa
autorizada; visitantes não podem forçar a reativação.

## Testes e liberação

- Contrato de integração estática em
  `tests/public_waitlist_integrity.test.js`.
- Verificar as duas sobrecargas e a ausência de `DO UPDATE`.
- Conferir os fluxos de inscrição inicial, duplicata e resolução.
- Validar o histórico de migrações; aplicar a alteração no Supabase
  somente por implantação versionada após aprovação do CI.
- Repetir o Security Advisor e testar com usuários anônimos.

## Outros pontos e decisão de autenticação

A exigência de MFA administrativo **não** será ativada. A PR #936 foi
encerrada sem merge por decisão expressa do proprietário. Os controles
administrativos permanecem baseados em autenticação, perfil autorizado,
permissões, RLS, validação de parâmetros e registro de eventos.

Proteções contra spam de telefones totalmente novos ainda exigem
limitação por origem/IP, rate limiting e, se adequado, proteção anti-bot
na borda. Esta migração não resolve spam com números alternados e
não deve ser descrita como substituta dessas medidas.

## SEO

Nenhuma alteração de metadados, `canonical`, indexação, estrutura de
página, URL ou conteúdo público indexável foi proposta.

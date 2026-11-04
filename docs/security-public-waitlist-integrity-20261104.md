# Etapa 3 — Proteção da lista pública de espera

Data: 04/11/2026. Projeto Supabase: `wnigzpvgsbpjdxvjzugt`.

## Problema verificado

Antes da implantação, as duas variantes de `public.join_public_class_seat_waitlist`
validavam turmas ativas de grupo e normalizavam o telefone,
mas usavam `ON CONFLICT DO UPDATE` sobre a chave
`(class_number, normalized_phone)`. Isso permite que qualquer visitante
com conhecimento do número sobrescreva o nome/WhatsApp de um lead
pré-existente e altere um lead `resolved` de volta para `waiting`.
O esquema privado não concede leitura ou escrita direta a visitantes,
mas as RPCs são intencionalmente públicas e `SECURITY DEFINER`.

## Alteração aplicada em produção em 04/11/2026

A migração `20261104022500_prevent_unauthenticated_waitlist_rewrites.sql`
substituiu o conflito de ambas as variantes por `DO NOTHING`. A primeira
inscrição permanece válida; novas inscrições com o mesmo telefone/turma
são idempotentes, sem reescrever nome, WhatsApp ou estado.

Não há mudanças na rota `/escolher-turma/`, em matrícula, cobrança,
código de autenticação, permissões de tabela ou busca de vagas.
Os dados existentes não são modificados. Para reativar um lead marcado
`resolved`, o professor deverá realizar uma ação administrativa
autorizada; visitantes não podem forçar a reativação.

## Validação da implantação

- PR #937 incorporada à `main`, commit
  `b25276cfd9d8de301dd535b44971a9c314a6c4f4`.
- Migração registrada atomicamente com versão
  `20261104022500` e nome
  `prevent_unauthenticated_waitlist_rewrites`.
  O mecanismo MCP padrão cria versões automaticamente; a operação foi
  registrada com o identificador imutável do arquivo Git na mesma transação
  que alterou as duas funções, sem modificar registros históricos.
- Confirmação de bytes idênticos entre a entrada do ledger de produção e o
  arquivo canônico Git: `exact_sql_matches_git=true`.
- SHA-256 normalizado do SQL em ambos os lados:
  `fcc1d0d3a327ec003b8831990fe2c956efae8d2eb0cdd283eb635d04f0a1aaa5`.
- Ambas as sobrecargas preservam `SECURITY DEFINER`, proprietário
  `postgres` e permissão pública de execução; ambas contêm
  `DO NOTHING`, nenhuma contém `DO UPDATE`.
- A tabela de espera manteve os seis registros anteriores.
- A consulta pública de disponibilidade de turmas respondeu com 27 linhas;
  a consulta pública de vagas do curso respondeu com 39 linhas.
- Tabelas do esquema `private` sem RLS: zero.
- Contrato estático da PR #937 passou no GitHub Actions.
- Security Advisor permanece com 10 avisos de RPCs anônimas e 198 de RPCs
  autenticadas `SECURITY DEFINER`; são superfícies em auditoria e não
  foram revogadas indiscriminadamente.

Os testes de SQL/catálogo são verificações somente leitura após a
implantação; não se executou tentativa destrutiva de duplicata com
contato real. A inscrição pública de novos contatos deve continuar
sendo monitorada em operação.

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

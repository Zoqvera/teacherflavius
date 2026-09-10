# Hardening global de acesso — 10/09/2026

Esta etapa reduz privilégios implícitos para objetos futuros do schema `public` e introduz contenção operacional de novas cobranças.

## Mudanças aplicadas

- default privileges do papel `postgres` passaram a ser opt-in para clientes;
- `anon` e `authenticated` deixam de herdar automaticamente privilégios em novas tabelas e sequences;
- novas funções não recebem `EXECUTE` de `PUBLIC`, `anon` ou `authenticated` por padrão;
- `service_role` mantém os privilégios necessários aos fluxos de servidor;
- a função técnica `suppress_excluded_marketing_visitor_events()` deixou de ser chamável pela Data API de clientes;
- `get_public_quartet_vacancies()` permanece uma exceção pública deliberada porque retorna disponibilidade agregada para o funil comercial;
- foi criado o kill switch de novas cobranças, administrado por Edge Function JWT+MFA e aplicado no banco antes da criação de uma tentativa de pagamento.

## Limites deliberados

Os default privileges do papel `supabase_admin` não foram alterados. Eles podem estar associados a objetos gerenciados pela plataforma. A política opt-in desta etapa se aplica ao papel `postgres`, utilizado pelas migrações de aplicação.

O Security Advisor continua apontando funções `SECURITY DEFINER` acessíveis a usuários autenticados em diversos módulos legados. Esses casos serão auditados progressivamente no trabalho de segurança global; não foram revogados em massa porque muitos constituem APIs legítimas do aluno ou do professor e precisam ser classificados antes de qualquer alteração.

A proteção contra senhas vazadas do Supabase Auth continua desabilitada e permanece uma ação separada de autenticação/segurança da conta.

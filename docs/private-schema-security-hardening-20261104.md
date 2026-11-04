# Endurecimento do esquema privado — 04/11/2026 UTC

## Objetivo
Aplicar defesa em profundidade ao esquema `private` do Supabase da
TeacherFlavius.com sem modificar regras de matrícula, crédito ou cobrança.

## Contexto e análise prévia
- Antes: 25 tabelas do esquema `private` sem RLS, 29 com RLS.
- Depois: 54 de 54 tabelas com RLS.
- Os papéis de navegador `anon` e `authenticated` não tinham `USAGE`
  no esquema `private` nem grants diretos de DML sobre as 25 tabelas.
- `postgres`, `service_role` e os papéis internos relevantes possuem
  `BYPASSRLS`. As rotinas server-side e os gatilhos executam com privilégios
  apropriados. Não foram adicionadas políticas RLS permissivas.
- Concessões `EXECUTE` herdadas por `PUBLIC`, `anon` e `authenticated`
  foram revogadas em todas as funções de `private`. Isso não impede chamadas
  internas privilegiadas nem o acionamento de triggers.

## Migrações efetivamente aplicadas na produção
Os nomes e timestamps dos arquivos correspondem ao ledger remoto:
- 20261104013111: `secure_private_billing_plan_rls`
- 20261104013135: `harden_private_rls_group_1_nov_2026`
- 20261104013138: `harden_private_rls_group_2_nov_2026`
- 20261104013141: `harden_private_rls_group_3_nov_2026`
- 20261104013215: `remove_browser_execute_grants_from_private_routines`

A sequência histórica anterior do repositório não deve ser reaplicada cegamente
a uma branch remota: consultar `supabase/branching/README.md` para os riscos
conhecidos de reconstrução e divergência do ledger.

## Validação realizada
- Catálogo: zero tabelas de `private` sem RLS.
- Privilégios: zero funções de `private` executáveis por `anon` ou
  `authenticated`.
- `USAGE` no esquema `private` continua negado para papéis de navegador.
- Consultas administrativas a `private.billing_plans`,
  `private.lesson_credits` e `public.monthly_tuition` responderam.
- A RPC pública de disponibilidade de turmas respondeu após a mudança.
- Testes estáticos versionados em `tests/private_schema_security_hardening.test.js`.

## Alertas remanescentes do Security Advisor
- `rls_enabled_no_policy` nas tabelas intencionalmente fechadas é informativo,
  não evidência de dados expostos.
- 10 funções `SECURITY DEFINER` executáveis por `anon`, ligadas principalmente
  a reserva de vagas, consulta pública de ofertas e avaliações.
- 198 funções `SECURITY DEFINER` executáveis por `authenticated` no esquema
  público. Muitas são APIs válidas de aluno ou professor. Exigem auditoria de
  autorização por RPC; **não** revogar em massa sem verificar chamadas ativas.
- Revisar periodicamente rate limiting, validação de tokens e controles
  de propriedade das reservas, matriculas e pagamentos.

## Decisão operacional
Não foi criada uma branch remota cobrada por hora. O custo consultado foi
0,01344 por hora (moeda do plano), com confirmação específica exigida.
A proteção de baixo risco foi aplicada após conferência de privilégios.
Uma branch remota para testes adicionais exige conciliar primeiro o histórico
de migrações e isolar Cron, Vault e integrações de pagamentos/e-mail.

## Reversão excepcional
Na hipótese de regressão demonstrada, cada `ENABLE ROW LEVEL SECURITY`
pode ser revertido para as tabelas correspondentes usando
`ALTER TABLE private.<tabela> DISABLE ROW LEVEL SECURITY`. Não alterar
privilégios públicos sem revisão. Priorizar diagnóstico do fluxo afetado
antes de qualquer reversão; não executar rollback preventivo.

## Exceção de identidade documental (auditada)
A migração já incorporada `20261104013111` contém duas linhas de
comentário no Git ausentes da instrução SQL efetivamente aplicada. A regra de
imutabilidade impede reescrever o arquivo histórico. O verificador de drift
aceita **somente** a dupla de hashes SHA256 conhecida:

- Produção: `679cbd483d1bd1b0a80062bf21b4dbac9f2eed63ac6e2187db46ccf894f7ade9`
- Git: `ab71e00aac45b4fec4a6c1276b220c17c7c220e7fc8b8295f1b3362f89aab92f`

Além da comparação exata de versão, nomes e hashes, a atestação SQL somente
leitura valida as 25 tabelas, o RLS de todo o esquema privado e a ausência de
permissões de navegador. Qualquer outro desvio continua falhando o CI.

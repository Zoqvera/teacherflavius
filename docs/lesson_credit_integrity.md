# Integridade dos créditos de aulas

## Semântica

A tabela `private.lesson_credits` preserva o estado operacional histórico em `status`.
A coluna `revoked_at` representa o bloqueio vigente do crédito, com prioridade
sobre esse estado histórico. Assim, `status = 'available'` com
`revoked_at IS NOT NULL` pode ser correto e **não é, por si só, um erro**.

Uma revogação não deve ser convertida automaticamente em `status = 'forfeited'`,
pois isso destruiria a distinção entre revogação contratual e perda por prazo.

As RPCs estudantis `get_my_lesson_credits`, `get_my_lessons_overview` e
`book_my_lesson_replacement` ignoram ou bloqueiam os créditos revogados.

## Auditoria periódica

O monitor `private.run_operational_data_quality_check(boolean)` agora utiliza
`private.lesson_credit_audit_snapshot()` a cada execução existente do
health check operacional. A auditoria separa:

| Classificação | Interpretação | Severidade |
| --- | --- | --- |
| `revoked_unpaid` | Mensalidade sem pagamento ou isenção | Esperado |
| `revoked_excess` | Crédito acima do plano mensal atual, revogado | Esperado; verificar histórico se necessário |
| `revoked_review` | Revogação sem causa identificada na situação atual | Revisão (warning) |
| `revoked_confirmed_booking` | Revogado, mas com reserva confirmada | Crítico |
| `active_unpaid` | Contratual não revogado, porém mensalidade não quitada | Crítico |
| `active_excess` | Contratual ativo acima do plano atual e sem justificativa documentada | Revisão (warning) |
| `approved_historical_exception` | Crédito contratual pago de competência anterior, preservado por decisão expressa do professor | Histórico justificado (informativo) |

As exceções aprovadas ficam em `private.lesson_credit_plan_exceptions`, com
referência ao crédito, justificativa administrativa e data de aprovação. A
sincronização de mensalidades quitadas deve respeitar essas exceções sem
reescrever `credit_origin = 'contract'` e sem revogar direitos preservados.
Se uma mensalidade for estornada, a proteção de créditos não pagos mantém
precedência e a exceção não impede o bloqueio financeiro.

**Limitação temporal:** `student_billing_settings.classes_per_month` descreve
o plano atual, e não necessariamente a quantidade contratada na competência
anterior. Portanto, `active_excess` e `revoked_review` sinalizam **revisão**,
nunca uma alteração automática. Não executar revogação em lote apenas por
diferença entre o plano atual e uma mensalidade antiga.

O resumo entra em `operational_data_quality_runs.metrics.lesson_credit_audit`
e os incidentes acionáveis entram nas issues do monitor global, no horário
já agendado para qualidade dos dados.

## Interface do professor

No painel `/reposicoes-admin/`, o professor encontra **Auditoria dos créditos
de aulas**, exibindo totais e até 100 registros detalhados. O rótulo principal
é o estado efetivo: quando `revoked_at IS NOT NULL`, exibe **Revogado** e
sua data, mesmo que o campo histórico seja `available` ou `scheduled`.

A consulta passa exclusivamente por `public.get_teacher_lesson_credit_audit()`,
que verifica `auth.uid()` e `public.is_teacher_admin()` no servidor. Não há
leitura direta de tabelas privadas no navegador nem operação de alteração.

## Cenários de regressão

1. **Estorno**: ao desfazer o pagamento, o crédito contratual deve ser
   revogado e ficar indisponível para reposição, independentemente do status.
2. **Novo pagamento**: quando a mensalidade voltar a ser quitada, a rotina
   canônica de sincronização pode reativar créditos a que o aluno tem direito.
3. **Redução de plano de 8 para 4 aulas**: créditos excedentes 5–8 revogados
   são classificados como `revoked_excess` e nunca entram nas opções de reserva.
4. **Crédito histórico**: créditos de competências anteriores acima do plano
   atual devem ser apenas sinalizados como `active_excess` até conferência.
5. **Reserva em crédito revogado**: uma reserva ainda confirmada produz alerta
   crítico; a função de agendamento recusa a utilização de crédito revogado.
6. **Autorização**: estudantes não acessam a RPC administrativa, mesmo
   conhecendo seu nome.

Não há alteração no conteúdo público, nas configurações de indexação ou no sitemap.

# Limpeza de integrações residuais do domínio financeiro

Data de referência: 12 de setembro de 2026.

## Objetivo

Manter somente integrações que tenham função operacional atual, sem apagar histórico de migração ou controles preventivos que documentam/removem dependências antigas.

## Resultado da revisão

### Hospedagem antiga

O runtime atual do TeacherFlavius.com é GitHub Pages. `netlify.toml` não existe mais na raiz do repositório e não foi encontrada uma árvore `netlify/` ativa.

Os únicos resíduos executáveis encontrados estavam nos filtros de paths do workflow `Production availability`, que ainda observavam:

- `netlify.toml`;
- `netlify/**`.

Esses filtros não têm função no hosting atual e foram removidos na etapa de limpeza.

Não remover referências históricas a Netlify em migrations antigas: elas registram o estado anterior e a migração que substituiu o processador de hospedagem por GitHub Pages. Migrations aplicadas são histórico imutável.

O guard do Security baseline que rejeita resíduo Netlify no output de deploy **deve permanecer**, porque funciona como controle preventivo para impedir reintrodução acidental da dependência.

### Provedores financeiros alternativos

A busca no código atual não encontrou integração ativa com Stripe, PagSeguro, PayPal, Adyen ou PicPay. O provedor financeiro em produção continua sendo Mercado Pago.

Não adicionar SDK, segredo, webhook ou abstração de um segundo provedor sem passar pelo `payment_provider_decision_gate.md`.

### Função residual `noop-schema-probe`

A Edge Function `noop-schema-probe` ainda está implantada no Supabase. A inspeção de 12 de setembro de 2026 confirmou:

- `verify_jwt = true`;
- resposta fixa HTTP 410;
- corpo `{"error":"disabled"}`;
- nenhuma operação de banco ou efeito financeiro.

A ferramenta de gerenciamento disponível nesta revisão não fornece operação de exclusão de Edge Function. Portanto, ela não pode ser removida automaticamente sem recorrer a um mecanismo não suportado.

A função deve continuar listada como resíduo técnico até que uma operação oficial de exclusão esteja disponível. Não reutilizar esse slug para outra finalidade.

### Sandbox Mercado Pago

`mercado-pago-sandbox-webhook` e `reconcile-mercado-pago-sandbox` permanecem intencionalmente implantadas porque constituem infraestrutura de validação isolada e usam credenciais de teste. Elas não são resíduo de produção.

As tabelas sandbox continuam separadas das tabelas financeiras de produção.

### Analytics de pagamentos

`capture-payment-analytics-context` e `dispatch-payment-analytics` foram adicionadas na Fase A de analytics server-side e são componentes atuais. O dispatcher permanece fail-closed até a configuração do `GA4_API_SECRET`; não deve ser removido como resíduo.

## Regra de exclusão

Uma integração só pode ser removida quando:

1. nenhum runtime atual depende dela;
2. não é necessária para rollback, auditoria ou sandbox;
3. não há cron, webhook ou secret ativo dependente;
4. contratos/testes foram atualizados;
5. a remoção não apaga migration histórica;
6. o health permanece saudável depois da mudança.

## Estado final desta revisão

- runtime de hospedagem antiga: sem componente ativo identificado;
- filtros obsoletos de CI para hospedagem antiga: removidos;
- segundo gateway de pagamento: inexistente;
- sandbox Mercado Pago: mantido intencionalmente;
- `noop-schema-probe`: isolada/desativada, remoção bloqueada apenas pela ausência de operação suportada na ferramenta conectada;
- histórico de migrations: preservado;
- guard anti-resíduo no Security baseline: preservado.

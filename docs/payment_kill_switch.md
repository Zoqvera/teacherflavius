# Kill switch de novas cobranças

## Objetivo

O controle de novas cobranças permite interromper a criação de novos pagamentos no Mercado Pago sem desligar a recuperação financeira existente. Webhooks, reconciliação, reembolsos, chargebacks, documentação e alertas continuam operacionais.

## Controle

O estado fica em `private.payment_creation_control`. Apenas uma linha singleton existe. Mudanças são auditadas em `private.payment_creation_control_events`.

O navegador administra o estado exclusivamente pela Edge Function `manage-payment-creation-control`, implantada com `verify_jwt=true`. A função valida a sessão e exige `is_teacher_admin_mfa()` antes de usar as RPCs internas:

- `get_payment_creation_control_internal()`
- `set_payment_creation_enabled_internal(boolean, text, uuid)`

Essas RPCs são executáveis somente por `service_role`; `PUBLIC`, `anon` e `authenticated` não têm `EXECUTE`.

## Bloqueio no banco

O trigger `tuition_payment_attempts_payment_creation_gate` executa antes de todo `INSERT` em `tuition_payment_attempts`. Quando novas cobranças estão desabilitadas, a operação falha com `payment_creation_disabled` antes de uma nova tentativa poder ser persistida.

Ao ativar o bloqueio, tentativas locais ainda ativas e sem `provider_payment_id` são canceladas e recebem uma nova chave de idempotência. Isso impede que um checkout interrompido reutilize uma tentativa local antiga para iniciar uma nova transação depois do bloqueio.

Uma requisição que já tenha passado pelo ponto de admissão imediatamente antes da ativação do kill switch pode estar em voo. Por isso, após um bloqueio de emergência, o dashboard, os webhooks e a reconciliação devem continuar sendo observados até que não haja transações pendentes.

## Interface administrativa

O módulo `payment_creation_control.js` é carregado somente em `/mensalidades/`. Ele mostra o estado atual e exige confirmação textual:

- `BLOQUEAR` para desativar novas cobranças, junto com um motivo de pelo menos cinco caracteres;
- `REATIVAR` para permitir novas cobranças novamente.

A interface nunca recebe acesso direto à tabela privada nem às RPCs internas.

## Default privileges globais

A migração `20260910022045_harden_global_defaults_and_add_payment_kill_switch` também altera os default privileges do papel `postgres` no schema `public`:

- novas tabelas não concedem privilégios automaticamente a `anon` ou `authenticated`;
- novas sequences não concedem privilégios automaticamente a esses papéis;
- novas funções não recebem `EXECUTE` de `PUBLIC`, `anon` ou `authenticated` por padrão;
- `service_role` mantém os privilégios necessários.

Os defaults de `supabase_admin` não são modificados nesta etapa para evitar interferência com objetos gerenciados pela plataforma. Objetos de aplicação devem continuar sendo criados pelas migrações do projeto e receber grants explícitos quando precisarem ser acessados pelo navegador.

## SECURITY DEFINER público

`public.suppress_excluded_marketing_visitor_events()` é uma função técnica de trigger e deixou de ser executável por `anon` e `authenticated`.

`public.get_public_quartet_vacancies()` permanece deliberadamente acessível porque fornece somente disponibilidade agregada de vagas utilizada no funil público. Esse caso deve continuar sendo tratado como exceção explícita e testada, não como precedente para novos grants anônimos.

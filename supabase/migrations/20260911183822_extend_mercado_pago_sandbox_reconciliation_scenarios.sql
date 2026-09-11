alter table public.mercado_pago_sandbox_reconciliation_candidates
  drop constraint if exists mercado_pago_sandbox_reconciliation_scenario_check;

alter table public.mercado_pago_sandbox_reconciliation_candidates
  add constraint mercado_pago_sandbox_reconciliation_scenario_check
  check (
    scenario in (
      'missed_webhook',
      'transient_gateway_503',
      'transient_gateway_timeout'
    )
  );

-- Harden the financial Data API surface so payment state is only exposed through
-- explicitly reviewed RPCs and Edge Functions.

revoke all privileges on table public.monthly_tuition from anon, authenticated;
revoke all privileges on table public.monthly_tuition_events from anon, authenticated;
revoke all privileges on table public.tuition_payment_attempts from anon, authenticated;
revoke all privileges on table public.payment_reconciliation_runs from anon, authenticated;
revoke all privileges on table public.payment_operational_events from anon, authenticated;
revoke all privileges on table public.payment_alert_notifications from anon, authenticated;
revoke all privileges on table public.payment_webhook_events from anon, authenticated;
revoke all privileges on table public.payment_refund_requests from anon, authenticated;
revoke all privileges on table public.payment_chargebacks from anon, authenticated;
revoke all privileges on table public.payment_chargeback_documentation_cases from anon, authenticated;
revoke all privileges on table public.payment_chargeback_documentation_events from anon, authenticated;
revoke all privileges on table public.payment_chargeback_evidence_items from anon, authenticated;

-- Keep service-side access explicit. RLS remains enabled as an additional boundary.
grant select, insert, update, delete on table public.monthly_tuition to service_role;
grant select, insert, update, delete on table public.monthly_tuition_events to service_role;
grant select, insert, update, delete on table public.tuition_payment_attempts to service_role;
grant select, insert, update, delete on table public.payment_reconciliation_runs to service_role;
grant select, insert, update, delete on table public.payment_operational_events to service_role;
grant select, insert, update, delete on table public.payment_alert_notifications to service_role;
grant select, insert, update, delete on table public.payment_webhook_events to service_role;
grant select, insert, update, delete on table public.payment_refund_requests to service_role;
grant select, insert, update, delete on table public.payment_chargebacks to service_role;
grant select, insert, update, delete on table public.payment_chargeback_documentation_cases to service_role;
grant select, insert, update, delete on table public.payment_chargeback_documentation_events to service_role;
grant select, insert, update, delete on table public.payment_chargeback_evidence_items to service_role;

-- Server-only financial RPCs must never be callable through an end-user Data API role.
do $$
declare
  target record;
begin
  for target in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'add_mercado_pago_chargeback_evidence',
        'begin_mercado_pago_reconciliation_run',
        'begin_mercado_pago_refund',
        'begin_mercado_pago_webhook_processing',
        'calculate_tuition_due_day_options',
        'delete_mercado_pago_chargeback_evidence',
        'finish_mercado_pago_reconciliation_run',
        'finish_mercado_pago_refund',
        'finish_mercado_pago_webhook_event',
        'generate_monthly_tuition__mfa_inner',
        'get_mercado_pago_chargeback_documentation',
        'get_teacher_monthly_tuition__mfa_inner',
        'get_teacher_student_tuition_history__mfa_inner',
        'list_mercado_pago_chargeback_documentation_cases',
        'list_mercado_pago_chargebacks',
        'list_mercado_pago_refund_candidates',
        'mark_mercado_pago_chargeback_documentation_submitted',
        'mark_mercado_pago_payment_reinstated',
        'mark_tuition_exempt__mfa_inner',
        'process_mercado_pago_payment',
        'record_mercado_pago_reconciliation_failure',
        'record_payment_operational_event',
        'record_tuition_payment__mfa_inner',
        'register_mercado_pago_webhook_event',
        'reverse_tuition_exemption__mfa_inner',
        'reverse_tuition_payment__mfa_inner',
        'save_mercado_pago_chargeback_documentation_case',
        'set_tuition_payment_attempt_updated_at',
        'update_mercado_pago_chargeback_evidence',
        'upsert_mercado_pago_chargeback',
        'validate_mercado_pago_reconciliation_signature'
      ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', target.signature);
    execute format('grant execute on function %s to service_role', target.signature);
  end loop;
end
$$;

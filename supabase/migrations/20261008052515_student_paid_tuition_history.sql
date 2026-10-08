-- Histórico de mensalidades acessível exclusivamente à conta autenticada.
-- Retorna uma linha por competência paga (sem dados de aluno nem detalhes do provedor).
create or replace function public.get_my_paid_tuition_history()
returns table (
  reference_month date,
  payment_date date,
  amount_paid numeric,
  payment_method text,
  payment_status text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    tuition.reference_month,
    tuition.payment_date,
    tuition.amount_paid,
    tuition.payment_method,
    case
      when tuition.amount_paid >= tuition.amount_due then 'paid'
      else 'partial'
    end::text as payment_status
  from public.monthly_tuition tuition
  where tuition.student_id = auth.uid()
    and tuition.payment_date is not null
    and tuition.amount_paid > 0
    and not coalesce(tuition.is_exempt, false)
  order by tuition.reference_month desc, tuition.payment_date desc, tuition.id desc;
$function$;

revoke all on function public.get_my_paid_tuition_history()
  from public, anon, authenticated;
grant execute on function public.get_my_paid_tuition_history()
  to authenticated, service_role;

notify pgrst, 'reload schema';

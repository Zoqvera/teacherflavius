-- Relatorio historico de parcelas preservadas apos remocao de perfis.
-- Nunca reativa cobrancas nem reatribui subject_ref a outro aluno.
create or replace function public.get_teacher_detached_tuition_history()
returns table (
  tuition_id uuid,
  subject_ref uuid,
  reference_month date,
  due_date date,
  amount_due numeric,
  amount_paid numeric,
  payment_date date,
  is_exempt boolean,
  financial_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'Acesso administrativo obrigatorio.' using errcode = '42501';
  end if;

  return query
  select
    tuition.id,
    tuition.subject_ref,
    tuition.reference_month,
    tuition.due_date,
    coalesce(tuition.amount_override, tuition.amount_due),
    tuition.amount_paid,
    tuition.payment_date,
    tuition.is_exempt,
    case
      when tuition.is_exempt then 'exempt'
      when tuition.payment_date is not null then 'paid'
      else 'no_payment'
    end::text
  from public.monthly_tuition as tuition
  where tuition.student_id is null
  order by tuition.reference_month desc, tuition.subject_ref, tuition.due_date, tuition.id;
end;
$function$;

revoke all on function public.get_teacher_detached_tuition_history() from public, anon, authenticated;
grant execute on function public.get_teacher_detached_tuition_history() to authenticated, service_role;

comment on function public.get_teacher_detached_tuition_history() is
  'Consulta administrativa somente leitura das mensalidades historicas sem perfil; sem pagamento nao implica divida exigivel.';

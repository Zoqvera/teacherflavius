-- Bloqueia acesso às áreas de estudo até a confirmação da primeira mensalidade
-- dos alunos matriculados pela oferta anuncio80.

create or replace function public.get_my_matricula80_payment_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  requester_id uuid := auth.uid();
  payment_required boolean;
begin
  if requester_id is null then
    raise exception 'Entre com sua conta Google para consultar a matrícula.'
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles profile
    join private.student_acquisition acquisition
      on acquisition.student_id = profile.id
    join public.student_billing_settings settings
      on settings.student_id = profile.id
    join public.monthly_tuition tuition
      on tuition.student_id = profile.id
      and tuition.reference_month = date_trunc('month', profile.tuition_first_due_date)::date
    where profile.id = requester_id
      and profile.enrolled = true
      and profile.archived = false
      and profile.profile_completed = true
      and acquisition.declared_source = 'anúncio80'
      and settings.monthly_fee = 80.00
      and profile.tuition_first_due_date is not null
      and tuition.payment_date is null
      and tuition.is_exempt = false
  )
  into payment_required;

  return jsonb_build_object('payment_required', payment_required);
end;
$function$;

revoke all on function public.get_my_matricula80_payment_gate() from public, anon;
grant execute on function public.get_my_matricula80_payment_gate() to authenticated;

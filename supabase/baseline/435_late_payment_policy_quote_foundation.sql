-- Foundation for contractual late-payment charges (not a billing activation).
-- No historical tuition amount, due date, payment or payment attempt is modified.
-- A versioned, explicit acceptance is required; historical arrears are NEVER backdated.
-- The payment gateway continues to charge only monthly_tuition.amount_due until
-- a separate, fully reconciled server-side rollout is enabled.

create or replace function private.calculate_late_payment_components(
  principal numeric,
  due_on date,
  effective_on date,
  as_of date
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  eligible_days integer;
  fine numeric(12,2) := 0;
  interest numeric(12,2) := 0;
  base numeric(12,2);
begin
  if principal is null or principal < 0 or due_on is null
     or effective_on is null or as_of is null then
    raise exception 'Parâmetros de cálculo financeiro inválidos.';
  end if;

  base := round(principal, 2);
  -- For an existing debt, the new contractual charges run only AFTER
  -- the effective acceptance date; never from the original past due date.
  eligible_days := greatest(0, as_of - greatest(due_on, effective_on));
  if eligible_days > 0 then
    fine := round(base * 0.02, 2);
    interest := round(base * 0.01 * eligible_days / 30, 2);
  end if;

  return jsonb_build_object(
    'principal_amount', base,
    'fine_amount', fine,
    'interest_amount', interest,
    'total_amount', base + fine + interest,
    'chargeable_days', eligible_days
  );
end;
$function$;

revoke all on function private.calculate_late_payment_components(
  numeric, date, date, date
) from public, anon, authenticated;
grant execute on function private.calculate_late_payment_components(
  numeric, date, date, date
) to service_role;

create or replace function private.get_tuition_late_payment_quote(
  target_tuition_id uuid,
  quote_date date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  target_tuition public.monthly_tuition%rowtype;
  agreement_date date;
  accepted_at_value timestamptz;
  attempt_amount numeric;
  components jsonb;
begin
  select *
  into target_tuition
  from public.monthly_tuition t
  where t.id = target_tuition_id;

  if not found then
    raise exception 'Mensalidade não encontrada.';
  end if;
  if quote_date is null then
    raise exception 'Data da cotação obrigatória.';
  end if;

  -- Preserve the immutable amount of a payment already sent to Mercado Pago.
  select a.amount
  into attempt_amount
  from public.tuition_payment_attempts a
  where a.tuition_id = target_tuition_id
    and a.provider_payment_id is not null
    and a.status in ('created','pending','authorized','in_process','in_mediation')
  order by a.created_at desc
  limit 1;

  select p.accepted_at
  into accepted_at_value
  from private.student_policy_acceptances p
  where p.student_id = target_tuition.student_id
    and p.policy_key = 'tuition-late-payment'
    and p.policy_version = '2026-10-20-v1';

  agreement_date := (accepted_at_value at time zone 'America/Sao_Paulo')::date;

  if target_tuition.payment_date is not null
     or coalesce(target_tuition.is_exempt, false)
     or accepted_at_value is null then
    components := private.calculate_late_payment_components(
      target_tuition.amount_due, target_tuition.due_date,
      quote_date, quote_date
    );
  else
    components := private.calculate_late_payment_components(
      target_tuition.amount_due, target_tuition.due_date,
      agreement_date, quote_date
    );
  end if;

  -- The preview cannot override a frozen third-party transaction.
  if attempt_amount is not null then
    components := jsonb_build_object(
      'principal_amount', round(target_tuition.amount_due, 2),
      'fine_amount', 0, 'interest_amount', 0,
      'total_amount', round(attempt_amount, 2),
      'chargeable_days', 0
    );
  end if;

  return components || jsonb_build_object(
    'tuition_id', target_tuition_id,
    'due_date', target_tuition.due_date,
    'quote_date', quote_date,
    'policy_version', '2026-10-20-v1',
    'terms_accepted_at', accepted_at_value,
    'preexisting_attempt', attempt_amount is not null,
    'preview_only', true
  );
end;
$function$;

revoke all on function private.get_tuition_late_payment_quote(uuid, date)
  from public, anon, authenticated;
grant execute on function private.get_tuition_late_payment_quote(uuid, date)
  to service_role;

create or replace function public.get_my_late_payment_terms()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  acceptance_at timestamptz;
  is_active_student boolean := false;
begin
  if caller_id is null then
    raise exception 'Faça login para consultar as condições financeiras.'
      using errcode = '42501';
  end if;

  select coalesce(profile.enrolled, false)
     and not coalesce(profile.archived, false)
  into is_active_student
  from public.profiles profile
  where profile.id = caller_id;

  select p.accepted_at into acceptance_at
  from private.student_policy_acceptances p
  where p.student_id = caller_id
    and p.policy_key = 'tuition-late-payment'
    and p.policy_version = '2026-10-20-v1';

  return jsonb_build_object(
    'policy_key', 'tuition-late-payment',
    'policy_version', '2026-10-20-v1',
    'active_student', coalesce(is_active_student, false),
    'accepted', acceptance_at is not null,
    'accepted_at', acceptance_at,
    'fine_percent', 2,
    'monthly_interest_percent', 1,
    'retroactive_charges_allowed', false,
    'billing_enabled', false
  );
end;
$function$;

revoke all on function public.get_my_late_payment_terms()
  from public, anon, authenticated;
grant execute on function public.get_my_late_payment_terms()
  to authenticated, service_role;

create or replace function public.accept_my_late_payment_terms(
  target_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  acceptance_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para aceitar as condições financeiras.'
      using errcode = '42501';
  end if;

  if target_policy_version is distinct from '2026-10-20-v1' then
    raise exception 'As condições foram atualizadas. Recarregue a página.';
  end if;

  select p.* into profile_row
  from public.profiles p
  where p.id = caller_id
  for update;

  if profile_row.id is null
     or not coalesce(profile_row.enrolled, false)
     or coalesce(profile_row.archived, false) then
    raise exception 'Apenas alunos matriculados e ativos podem aceitar.'
      using errcode = '42501';
  end if;

  if profile_row.date_of_birth is null
     or profile_row.date_of_birth > (
       timezone('America/Sao_Paulo', now())::date - interval '18 years'
     )::date then
    raise exception 'Para aluno menor de idade, a atualização financeira precisa ser formalizada pelo responsável legal.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.teacher_admins a
    where a.user_id = caller_id
       or lower(a.email) = lower(coalesce(profile_row.email, ''))
  ) then
    raise exception 'Condições financeiras destinadas somente a alunos.'
      using errcode = '42501';
  end if;

  insert into private.student_policy_acceptances (
    student_id, policy_key, policy_version, accepted_at
  ) values (
    caller_id, 'tuition-late-payment', '2026-10-20-v1', now()
  ) on conflict (student_id, policy_key, policy_version) do nothing;

  select p.accepted_at into acceptance_at
  from private.student_policy_acceptances p
  where p.student_id = caller_id
    and p.policy_key = 'tuition-late-payment'
    and p.policy_version = '2026-10-20-v1';

  return jsonb_build_object(
    'ok', true,
    'policy_version', '2026-10-20-v1',
    'accepted_at', acceptance_at,
    'billing_enabled', false
  );
end;
$function$;

revoke all on function public.accept_my_late_payment_terms(text)
  from public, anon, authenticated;
grant execute on function public.accept_my_late_payment_terms(text)
  to authenticated, service_role;

create or replace function public.get_my_late_tuition_quote(
  target_tuition_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  quote_date date := timezone('America/Sao_Paulo', now())::date;
begin
  if caller_id is null or not exists (
    select 1 from public.monthly_tuition t
    where t.id = target_tuition_id and t.student_id = caller_id
  ) then
    raise exception 'Mensalidade não encontrada para esta conta.'
      using errcode = '42501';
  end if;

  return private.get_tuition_late_payment_quote(target_tuition_id, quote_date);
end;
$function$;

revoke all on function public.get_my_late_tuition_quote(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_late_tuition_quote(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

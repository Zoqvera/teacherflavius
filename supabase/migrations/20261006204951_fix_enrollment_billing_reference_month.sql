-- Canonicalize the initial tuition competence to the month of the first due date.
-- This prevents month-boundary enrollments from creating two consecutive
-- competences with the same due date while keeping the first tuition payable
-- immediately after enrollment.

create or replace function public.set_my_enrollment_billing_terms(
  target_monthly_fee numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  anchor_date date;
  first_due_date date;
  effective_due_day smallint;
  start_month date;
  authorized_monthly_fee numeric(10, 2);
  authorized_classes_per_month smallint;
begin
  if caller_id is null then
    raise exception 'Faça login para informar os dados da matrícula.'
      using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  if coalesce(profile_row.enrolled, false)
     or coalesce(profile_row.profile_completed, false)
  then
    raise exception 'Os dados comerciais da matrícula só podem ser definidos antes da conclusão do cadastro.';
  end if;

  select access.monthly_fee, access.classes_per_month
  into authorized_monthly_fee, authorized_classes_per_month
  from private.student_enrollment_access access
  where access.user_id = caller_id
    and access.authorized_at is not null
    and access.monthly_fee is not null
    and access.classes_per_month is not null;

  if not found then
    raise exception 'Valide um código de matrícula com condições comerciais antes de continuar.'
      using errcode = '42501';
  end if;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', now())::date
  );

  first_due_date := coalesce(
    profile_row.tuition_first_due_date,
    anchor_date
  );

  effective_due_day := coalesce(
    profile_row.tuition_due_day,
    extract(day from first_due_date)::smallint
  );

  start_month := date_trunc('month', first_due_date)::date;

  insert into public.student_billing_settings (
    student_id,
    monthly_fee,
    due_day,
    billing_start_month,
    active,
    notes,
    updated_by,
    classes_per_month
  )
  values (
    caller_id,
    authorized_monthly_fee,
    effective_due_day,
    start_month,
    true,
    null,
    caller_id,
    authorized_classes_per_month
  )
  on conflict (student_id) do update
  set
    monthly_fee = excluded.monthly_fee,
    due_day = excluded.due_day,
    billing_start_month = excluded.billing_start_month,
    active = true,
    updated_at = now(),
    updated_by = caller_id,
    classes_per_month = excluded.classes_per_month;

  return jsonb_build_object(
    'ok', true,
    'classes_per_month', authorized_classes_per_month,
    'monthly_fee', authorized_monthly_fee,
    'due_day', effective_due_day,
    'billing_start_month', start_month
  );
end;
$function$;

revoke all on function public.set_my_enrollment_billing_terms(numeric)
  from public, anon;
grant execute on function public.set_my_enrollment_billing_terms(numeric)
  to authenticated, service_role;

-- Repair only the direction produced by the month-boundary defect. Do not move
-- legacy schedules whose billing start was intentionally set after the first
-- recorded due date.
update public.student_billing_settings settings
set
  billing_start_month = date_trunc('month', profile.tuition_first_due_date)::date,
  updated_at = now()
from public.profiles profile
where profile.id = settings.student_id
  and settings.active = true
  and profile.tuition_first_due_date is not null
  and settings.billing_start_month
      < date_trunc('month', profile.tuition_first_due_date)::date;

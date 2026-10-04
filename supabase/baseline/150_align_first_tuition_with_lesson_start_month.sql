-- Align the first tuition reference month with the month in which lessons start.
-- The due date may fall in a later month without delaying lesson entitlement.

create or replace function private.ensure_first_tuition_for_student(
  target_student_id uuid,
  target_first_due_date date
)
returns uuid
language plpgsql
set search_path = 'public', 'private', 'pg_temp'
as $function$
declare
  billing_row public.student_billing_settings%rowtype;
  target_reference_month date;
  tuition_id uuid;
begin
  if target_student_id is null or target_first_due_date is null then
    return null;
  end if;

  select settings.*
  into billing_row
  from public.student_billing_settings settings
  where settings.student_id = target_student_id
    and settings.active = true
    and settings.monthly_fee is not null
    and settings.monthly_fee > 0;

  if not found then
    return null;
  end if;

  target_reference_month := billing_row.billing_start_month;

  insert into public.monthly_tuition (
    student_id,
    subject_ref,
    reference_month,
    due_date,
    amount_due
  )
  values (
    target_student_id,
    target_student_id,
    target_reference_month,
    target_first_due_date,
    billing_row.monthly_fee
  )
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = coalesce(public.monthly_tuition.amount_override, excluded.amount_due),
    updated_at = now()
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
  returning id into tuition_id;

  if tuition_id is null then
    select tuition.id
    into tuition_id
    from public.monthly_tuition tuition
    where tuition.student_id = target_student_id
      and tuition.reference_month = target_reference_month;
  end if;

  return tuition_id;
end;
$function$;

revoke execute on function private.ensure_first_tuition_for_student(uuid, date)
  from public, anon, authenticated;
grant execute on function private.ensure_first_tuition_for_student(uuid, date)
  to service_role;

create or replace function public.set_my_enrollment_billing_terms(
  target_classes_per_month integer,
  target_monthly_fee numeric
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
  normalized_fee numeric;
begin
  if caller_id is null then
    raise exception 'Faça login para informar os dados da matrícula.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  if coalesce(profile_row.enrolled, false) or coalesce(profile_row.profile_completed, false) then
    raise exception 'Os dados comerciais da matrícula só podem ser definidos antes da conclusão do cadastro.';
  end if;

  if not exists (
    select 1
    from private.student_enrollment_access access
    where access.user_id = caller_id
      and access.authorized_at is not null
  ) then
    raise exception 'Valide o código de acesso à matrícula antes de continuar.' using errcode = '42501';
  end if;

  if target_classes_per_month is null
     or target_classes_per_month < 1
     or target_classes_per_month > 31 then
    raise exception 'Informe a quantidade de aulas por mês entre 1 e 31.';
  end if;

  normalized_fee := round(target_monthly_fee, 2);
  if normalized_fee is null or normalized_fee <= 0 then
    raise exception 'Informe um valor de mensalidade maior que zero.';
  end if;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  first_due_date := coalesce(
    profile_row.tuition_first_due_date,
    anchor_date + 7
  );

  effective_due_day := coalesce(
    profile_row.tuition_due_day,
    extract(day from first_due_date)::smallint
  );

  start_month := date_trunc(
    'month',
    timezone('America/Sao_Paulo', now())::date
  )::date;

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
    normalized_fee,
    effective_due_day,
    start_month,
    true,
    null,
    caller_id,
    target_classes_per_month::smallint
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
    'classes_per_month', target_classes_per_month,
    'monthly_fee', normalized_fee,
    'due_day', effective_due_day,
    'billing_start_month', start_month
  );
end;
$function$;

revoke execute on function public.set_my_enrollment_billing_terms(integer, numeric)
  from public, anon;
grant execute on function public.set_my_enrollment_billing_terms(integer, numeric)
  to authenticated, service_role;

create or replace function public.activate_completed_google_student_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $function$
declare
  provider_name text;
  candidate_code text;
  clean_cpf text;
  clean_whatsapp text;
  anchor_date date;
  automatic_first_due_date date;
  billing_monthly_fee numeric;
  billing_classes_per_month smallint;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  select u.raw_app_meta_data ->> 'provider'
    into provider_name
  from auth.users u
  where u.id = new.id;

  if coalesce(new.profile_completed, false) = true
     and coalesce(new.enrolled, false) = false
     and provider_name = 'google'
     and not exists (
       select 1
       from public.teacher_admins ta
       where ta.user_id = new.id
          or lower(ta.email) = lower(coalesce(new.email, ''))
     ) then
    if not exists (
      select 1
      from private.student_enrollment_access access
      where access.user_id = new.id
        and access.authorized_at is not null
    ) then
      raise exception 'Valide o código de acesso à matrícula antes de concluir o cadastro.'
        using errcode = '42501';
    end if;

    clean_cpf := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
    clean_whatsapp := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');

    if nullif(btrim(coalesce(new.name, '')), '') is null then
      raise exception 'Informe o nome completo para concluir a matrícula.';
    end if;

    if nullif(btrim(coalesce(new.email, '')), '') is null then
      raise exception 'A conta Google precisa ter um e-mail válido para concluir a matrícula.';
    end if;

    if new.date_of_birth is null then
      raise exception 'Informe a data de nascimento para concluir a matrícula.';
    end if;

    if length(clean_cpf) <> 11 then
      raise exception 'Informe um CPF válido com 11 dígitos para concluir a matrícula.';
    end if;

    if length(clean_whatsapp) < 10 then
      raise exception 'Informe um WhatsApp válido para concluir a matrícula.';
    end if;

    select settings.monthly_fee, settings.classes_per_month
    into billing_monthly_fee, billing_classes_per_month
    from public.student_billing_settings settings
    where settings.student_id = new.id
      and settings.active = true;

    if not found
       or billing_monthly_fee is null
       or billing_monthly_fee <= 0
       or billing_classes_per_month is null
       or billing_classes_per_month < 1
       or billing_classes_per_month > 31 then
      raise exception 'Informe a quantidade de aulas por mês e o valor combinado com o professor antes de concluir a matrícula.';
    end if;

    if new.tuition_due_day is null then
      anchor_date := coalesce(
        new.tuition_due_day_anchor_date,
        timezone('America/Sao_Paulo', new.created_at)::date,
        timezone('America/Sao_Paulo', now())::date
      );
      automatic_first_due_date := anchor_date + 7;

      new.tuition_due_day := extract(day from automatic_first_due_date)::smallint;
      new.tuition_due_day_anchor_date := anchor_date;
      new.tuition_due_day_selected_at := now();
      new.tuition_first_due_date := automatic_first_due_date;
      new.tuition_due_day_source := 'system';

      update public.student_billing_settings settings
      set
        due_day = new.tuition_due_day,
        billing_start_month = date_trunc(
          'month',
          timezone('America/Sao_Paulo', now())::date
        )::date,
        updated_at = now()
      where settings.student_id = new.id;
    end if;

    new.enrolled := true;

    if nullif(btrim(new.enrollment_code), '') is null then
      loop
        candidate_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 5));
        exit when not exists (
          select 1
          from public.profiles p
          where p.enrollment_code = candidate_code
            and p.id <> new.id
        );
      end loop;
      new.enrollment_code := candidate_code;
    end if;

    if new.exercise_schedule_start_date is null then
      new.exercise_schedule_start_date := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;

  return new;
end;
$function$;

with current_clock as (
  select date_trunc(
    'month',
    timezone('America/Sao_Paulo', now())::date
  )::date as current_month
),
candidates as (
  select
    tuition.id as tuition_id,
    tuition.student_id,
    clock.current_month
  from public.monthly_tuition tuition
  join public.student_billing_settings settings
    on settings.student_id = tuition.student_id
  join public.profiles profile
    on profile.id = tuition.student_id
  cross join current_clock clock
  where coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false
    and date_trunc(
      'month',
      timezone('America/Sao_Paulo', profile.enrolled_at)::date
    )::date = clock.current_month
    and settings.billing_start_month > clock.current_month
    and tuition.reference_month = settings.billing_start_month
    and not exists (
      select 1
      from public.monthly_tuition existing
      where existing.student_id = tuition.student_id
        and existing.reference_month = clock.current_month
    )
    and not exists (
      select 1
      from private.lesson_credits credit
      where credit.tuition_id = tuition.id
        and credit.revoked_at is null
    )
)
update public.monthly_tuition tuition
set
  reference_month = candidate.current_month,
  updated_at = now()
from candidates candidate
where tuition.id = candidate.tuition_id;

with current_clock as (
  select date_trunc(
    'month',
    timezone('America/Sao_Paulo', now())::date
  )::date as current_month
)
update public.student_billing_settings settings
set
  billing_start_month = clock.current_month,
  updated_at = now()
from public.profiles profile
cross join current_clock clock
where profile.id = settings.student_id
  and coalesce(profile.enrolled, false) = true
  and coalesce(profile.archived, false) = false
  and date_trunc(
    'month',
    timezone('America/Sao_Paulo', profile.enrolled_at)::date
  )::date = clock.current_month
  and settings.billing_start_month > clock.current_month
  and exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = settings.student_id
      and tuition.reference_month = clock.current_month
      and tuition.due_date = profile.tuition_first_due_date
  );

with current_clock as (
  select date_trunc(
    'month',
    timezone('America/Sao_Paulo', now())::date
  )::date as current_month
),
paid_first as (
  select
    tuition.student_id,
    tuition.subject_ref,
    tuition.reference_month,
    settings.monthly_fee,
    settings.due_day
  from public.monthly_tuition tuition
  join public.student_billing_settings settings
    on settings.student_id = tuition.student_id
   and settings.active = true
  cross join current_clock clock
  where tuition.reference_month = clock.current_month
    and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
    and settings.billing_start_month = clock.current_month
    and exists (
      select 1
      from public.profiles profile
      where profile.id = tuition.student_id
        and date_trunc(
          'month',
          timezone('America/Sao_Paulo', profile.enrolled_at)::date
        )::date = clock.current_month
        and profile.tuition_first_due_date = tuition.due_date
    )
)
insert into public.monthly_tuition (
  student_id,
  subject_ref,
  reference_month,
  due_date,
  amount_due,
  created_by,
  updated_by
)
select
  paid.student_id,
  coalesce(paid.subject_ref, paid.student_id),
  (paid.reference_month + interval '1 month')::date,
  make_date(
    extract(year from (paid.reference_month + interval '1 month'))::integer,
    extract(month from (paid.reference_month + interval '1 month'))::integer,
    least(
      paid.due_day::integer,
      extract(
        day from (
          date_trunc('month', paid.reference_month + interval '1 month')
          + interval '1 month - 1 day'
        )
      )::integer
    )
  ),
  round(paid.monthly_fee, 2),
  null,
  null
from paid_first paid
on conflict (student_id, reference_month) do nothing;

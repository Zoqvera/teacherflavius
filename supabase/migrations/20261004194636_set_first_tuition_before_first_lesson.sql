-- First tuition must be due on enrollment day or no later than six days before the first scheduled lesson.
-- Existing students with a previously selected first due date are preserved.

create or replace function private.get_enrollment_tuition_schedule(
  target_student_id uuid,
  target_enrollment_date date
)
returns table (
  first_lesson_date date,
  latest_due_date date,
  due_date_options date[]
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with candidate_dates as (
    select
      (
        target_enrollment_date
        + (
          (
            class.class_weekday::integer
            - extract(isodow from target_enrollment_date)::integer
            + 7
          ) % 7
        )
      )::date as lesson_date
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
    where membership.user_id = target_student_id
      and class.is_active = true
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
  ),
  first_lesson as (
    select min(candidate.lesson_date)::date as first_lesson_date
    from candidate_dates candidate
  ),
  bounds as (
    select
      first_lesson.first_lesson_date,
      case
        when first_lesson.first_lesson_date is null then target_enrollment_date
        when first_lesson.first_lesson_date - 6 <= target_enrollment_date
          then target_enrollment_date
        else first_lesson.first_lesson_date - 6
      end::date as latest_due_date
    from first_lesson
  )
  select
    bounds.first_lesson_date,
    bounds.latest_due_date,
    array(
      select generated_day::date
      from generate_series(
        target_enrollment_date::timestamp,
        bounds.latest_due_date::timestamp,
        interval '1 day'
      ) generated_day
      order by generated_day
    )::date[] as due_date_options
  from bounds;
$function$;

revoke execute on function private.get_enrollment_tuition_schedule(uuid, date)
  from public, anon, authenticated;
grant execute on function private.get_enrollment_tuition_schedule(uuid, date)
  to service_role;

create or replace function public.get_my_tuition_due_day_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  enrollment_date date;
  schedule_row record;
  legacy_day_options smallint[];
begin
  if caller_id is null then
    raise exception 'Faça login para escolher o vencimento.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  enrollment_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', now())::date
  );

  select *
  into schedule_row
  from private.get_enrollment_tuition_schedule(caller_id, enrollment_date);

  select coalesce(
    array_agg(extract(day from option_date)::smallint order by option_date),
    '{}'::smallint[]
  )
  into legacy_day_options
  from unnest(schedule_row.due_date_options) option_date;

  return jsonb_build_object(
    'anchor_date', enrollment_date,
    'first_lesson_date', schedule_row.first_lesson_date,
    'latest_due_date', schedule_row.latest_due_date,
    'date_options', to_jsonb(schedule_row.due_date_options),
    'options', to_jsonb(legacy_day_options),
    'selected_due_day', profile_row.tuition_due_day,
    'selected_due_date', profile_row.tuition_first_due_date,
    'first_due_date', profile_row.tuition_first_due_date
  );
end;
$function$;

revoke execute on function public.get_my_tuition_due_day_options()
  from public, anon;
grant execute on function public.get_my_tuition_due_day_options()
  to authenticated, service_role;

create or replace function public.set_my_tuition_due_date(target_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  enrollment_date date;
  schedule_row record;
  chosen_first_due_date date;
  effective_due_day smallint;
  due_day_source text;
  system_start_month date;
  first_tuition_id uuid;
begin
  if caller_id is null then
    raise exception 'Faça login para escolher o vencimento.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  enrollment_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', now())::date
  );

  if profile_row.tuition_due_day is not null
     and profile_row.tuition_first_due_date is not null then
    if target_due_date is null
       or target_due_date = profile_row.tuition_first_due_date then
      return jsonb_build_object(
        'ok', true,
        'due_day', profile_row.tuition_due_day,
        'first_due_date', profile_row.tuition_first_due_date,
        'billing_start_month', date_trunc('month', profile_row.tuition_first_due_date)::date,
        'already_selected', true,
        'auto_assigned', profile_row.tuition_due_day_source = 'system'
      );
    end if;

    raise exception 'O vencimento já foi escolhido para esta matrícula.';
  end if;

  select *
  into schedule_row
  from private.get_enrollment_tuition_schedule(caller_id, enrollment_date);

  chosen_first_due_date := coalesce(target_due_date, enrollment_date);

  if not (chosen_first_due_date = any(schedule_row.due_date_options)) then
    raise exception 'Escolha uma data de vencimento dentro do período permitido.';
  end if;

  effective_due_day := extract(day from chosen_first_due_date)::smallint;
  due_day_source := case when target_due_date is null then 'system' else 'student' end;
  system_start_month := date_trunc('month', chosen_first_due_date)::date;

  update public.profiles
  set
    tuition_due_day = effective_due_day,
    tuition_due_day_anchor_date = enrollment_date,
    tuition_due_day_selected_at = now(),
    tuition_first_due_date = chosen_first_due_date,
    tuition_due_day_source = due_day_source
  where id = caller_id;

  update public.student_billing_settings
  set
    due_day = effective_due_day,
    billing_start_month = system_start_month,
    updated_at = now()
  where student_id = caller_id;

  first_tuition_id := private.ensure_first_tuition_for_student(
    caller_id,
    chosen_first_due_date
  );

  return jsonb_build_object(
    'ok', true,
    'due_day', effective_due_day,
    'first_due_date', chosen_first_due_date,
    'first_lesson_date', schedule_row.first_lesson_date,
    'latest_due_date', schedule_row.latest_due_date,
    'billing_start_month', system_start_month,
    'already_selected', false,
    'auto_assigned', target_due_date is null,
    'first_tuition_id', first_tuition_id
  );
end;
$function$;

revoke execute on function public.set_my_tuition_due_date(date)
  from public, anon;
grant execute on function public.set_my_tuition_due_date(date)
  to authenticated, service_role;

create or replace function public.set_my_tuition_due_day(target_due_day integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  enrollment_date date;
  schedule_row record;
  compatible_due_date date;
begin
  if caller_id is null then
    raise exception 'Faça login para escolher o vencimento.' using errcode = '42501';
  end if;

  if target_due_day is null then
    return public.set_my_tuition_due_date(null);
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  if profile_row.tuition_due_day is not null
     and profile_row.tuition_first_due_date is not null then
    if profile_row.tuition_due_day = target_due_day then
      return public.set_my_tuition_due_date(profile_row.tuition_first_due_date);
    end if;
    raise exception 'O vencimento já foi escolhido para esta matrícula.';
  end if;

  enrollment_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', now())::date
  );

  select *
  into schedule_row
  from private.get_enrollment_tuition_schedule(caller_id, enrollment_date);

  select min(option_date)
  into compatible_due_date
  from unnest(schedule_row.due_date_options) option_date
  where extract(day from option_date)::integer = target_due_day;

  if compatible_due_date is null then
    raise exception 'Escolha uma data de vencimento dentro do período permitido.';
  end if;

  return public.set_my_tuition_due_date(compatible_due_date);
end;
$function$;

revoke execute on function public.set_my_tuition_due_day(integer)
  from public, anon;
grant execute on function public.set_my_tuition_due_day(integer)
  to authenticated, service_role;

create or replace function public.set_my_enrollment_billing_terms(
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
  derived_classes_per_month smallint;
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

  normalized_fee := round(target_monthly_fee, 2);
  derived_classes_per_month :=
    private.enrollment_classes_per_month_for_fee(normalized_fee);

  if derived_classes_per_month is null then
    raise exception 'Escolha um valor de mensalidade válido: R$ 50,00, R$ 99,90, R$ 100,00 ou R$ 250,00.';
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
    derived_classes_per_month
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
    'classes_per_month', derived_classes_per_month,
    'monthly_fee', normalized_fee,
    'due_day', effective_due_day,
    'billing_start_month', start_month
  );
end;
$function$;

revoke execute on function public.set_my_enrollment_billing_terms(numeric)
  from public, anon;
grant execute on function public.set_my_enrollment_billing_terms(numeric)
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
  expected_classes_per_month smallint;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  select user_account.raw_app_meta_data ->> 'provider'
    into provider_name
  from auth.users user_account
  where user_account.id = new.id;

  if coalesce(new.profile_completed, false) = true
     and coalesce(new.enrolled, false) = false
     and provider_name = 'google'
     and not exists (
       select 1
       from public.teacher_admins admin
       where admin.user_id = new.id
          or lower(admin.email) = lower(coalesce(new.email, ''))
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

    expected_classes_per_month :=
      private.enrollment_classes_per_month_for_fee(billing_monthly_fee);

    if not found
       or expected_classes_per_month is null
       or billing_classes_per_month is distinct from expected_classes_per_month then
      raise exception 'Escolha um valor de mensalidade válido antes de concluir a matrícula.';
    end if;

    if new.tuition_due_day is null then
      anchor_date := coalesce(
        new.tuition_due_day_anchor_date,
        timezone('America/Sao_Paulo', now())::date
      );
      automatic_first_due_date := anchor_date;

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
          automatic_first_due_date
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
          from public.profiles profile
          where profile.enrollment_code = candidate_code
            and profile.id <> new.id
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

notify pgrst, 'reload schema';

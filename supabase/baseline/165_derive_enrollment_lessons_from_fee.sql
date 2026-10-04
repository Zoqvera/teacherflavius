-- Recovery overlay for deriving new-enrollment lesson quantity from the selected monthly fee.

create or replace function private.enrollment_classes_per_month_for_fee(
  target_monthly_fee numeric
)
returns smallint
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case round(target_monthly_fee, 2)
    when 50.00 then 4::smallint
    when 100.00 then 8::smallint
    when 99.90 then 4::smallint
    when 250.00 then 4::smallint
    else null::smallint
  end;
$function$;

revoke execute on function private.enrollment_classes_per_month_for_fee(numeric)
  from public, anon, authenticated;
grant execute on function private.enrollment_classes_per_month_for_fee(numeric)
  to service_role;

drop function if exists public.set_my_enrollment_billing_terms(integer, numeric);

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

notify pgrst, 'reload schema';

-- Recovery overlay for the seven-day automatic tuition due-date fallback.

alter table public.profiles
  add column if not exists tuition_due_day smallint,
  add column if not exists tuition_due_day_anchor_date date,
  add column if not exists tuition_due_day_selected_at timestamptz,
  add column if not exists tuition_first_due_date date,
  add column if not exists tuition_due_day_source text;

alter table public.profiles
  drop constraint if exists profiles_tuition_due_day_check,
  drop constraint if exists profiles_tuition_due_day_source_check;

alter table public.profiles
  add constraint profiles_tuition_due_day_check
  check (tuition_due_day is null or tuition_due_day between 1 and 31),
  add constraint profiles_tuition_due_day_source_check
  check (
    tuition_due_day_source is null
    or tuition_due_day_source in ('student', 'admin', 'legacy', 'system')
  );

create or replace function public.calculate_tuition_due_day_options(target_anchor_date date)
returns smallint[]
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select array[
    extract(day from target_anchor_date)::smallint,
    extract(day from (target_anchor_date + 5))::smallint,
    extract(day from (target_anchor_date + 8))::smallint
  ];
$function$;

revoke execute on function public.calculate_tuition_due_day_options(date)
  from public, anon, authenticated;

create or replace function public.get_my_tuition_due_day_options()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  anchor_date date;
  due_day_options smallint[];
begin
  if auth.uid() is null then
    raise exception 'Faça login para escolher o vencimento.' using errcode = '42501';
  end if;

  select p.*
  into profile_row
  from public.profiles p
  where p.id = auth.uid();

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );
  due_day_options := public.calculate_tuition_due_day_options(anchor_date);

  return jsonb_build_object(
    'anchor_date', anchor_date,
    'selected_due_day', profile_row.tuition_due_day,
    'first_due_date', profile_row.tuition_first_due_date,
    'options', to_jsonb(due_day_options)
  );
end;
$function$;

revoke execute on function public.get_my_tuition_due_day_options() from public, anon;
grant execute on function public.get_my_tuition_due_day_options() to authenticated, service_role;

create or replace function public.set_my_tuition_due_day(target_due_day integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  anchor_date date;
  due_day_options smallint[];
  chosen_first_due_date date;
  effective_due_day smallint;
  due_day_source text;
  system_start_month date;
  auto_assigned boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Faça login para escolher o vencimento.' using errcode = '42501';
  end if;

  select p.*
  into profile_row
  from public.profiles p
  where p.id = auth.uid()
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );
  due_day_options := public.calculate_tuition_due_day_options(anchor_date);

  if profile_row.tuition_due_day is not null then
    if target_due_day is null or profile_row.tuition_due_day = target_due_day then
      return jsonb_build_object(
        'ok', true,
        'due_day', profile_row.tuition_due_day,
        'first_due_date', profile_row.tuition_first_due_date,
        'billing_start_month', case
          when profile_row.tuition_first_due_date is not null
            then date_trunc('month', profile_row.tuition_first_due_date)::date
          else date_trunc('month', anchor_date)::date
        end,
        'already_selected', true,
        'auto_assigned', profile_row.tuition_due_day_source = 'system'
      );
    end if;

    raise exception 'O dia de vencimento já foi escolhido para esta matrícula.';
  end if;

  if target_due_day is null then
    chosen_first_due_date := anchor_date + 7;
    effective_due_day := extract(day from chosen_first_due_date)::smallint;
    due_day_source := 'system';
    auto_assigned := true;
  else
    if not (target_due_day::smallint = any(due_day_options)) then
      raise exception 'Escolha uma das três opções de vencimento disponíveis.';
    end if;

    chosen_first_due_date := case
      when target_due_day = extract(day from anchor_date)::integer then anchor_date
      when target_due_day = extract(day from (anchor_date + 5))::integer then anchor_date + 5
      when target_due_day = extract(day from (anchor_date + 8))::integer then anchor_date + 8
      else null
    end;
    effective_due_day := target_due_day::smallint;
    due_day_source := 'student';
  end if;

  system_start_month := date_trunc('month', chosen_first_due_date)::date;

  update public.profiles
  set
    tuition_due_day = effective_due_day,
    tuition_due_day_anchor_date = anchor_date,
    tuition_due_day_selected_at = now(),
    tuition_first_due_date = chosen_first_due_date,
    tuition_due_day_source = due_day_source
  where id = auth.uid();

  update public.student_billing_settings
  set
    due_day = effective_due_day,
    billing_start_month = system_start_month,
    updated_at = now()
  where student_id = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'due_day', effective_due_day,
    'first_due_date', chosen_first_due_date,
    'billing_start_month', system_start_month,
    'already_selected', false,
    'auto_assigned', auto_assigned
  );
end;
$function$;

revoke execute on function public.set_my_tuition_due_day(integer) from public, anon;
grant execute on function public.set_my_tuition_due_day(integer) to authenticated, service_role;

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

      update public.student_billing_settings
      set
        due_day = new.tuition_due_day,
        billing_start_month = date_trunc('month', automatic_first_due_date)::date,
        updated_at = now()
      where student_id = new.id;
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


create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  requester_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if current_user = 'authenticated'
     and auth.uid() is not null
     and not coalesce(public.is_teacher_admin(), false)
  then
    if tg_op = 'INSERT' then
      new.email := requester_email;
      new.created_at := now();
      new.enrollment_code := null;
      new.enrolled := false;
      new.exercise_schedule_start_date := null;
      new.archived := false;
      new.archived_at := null;
      new.class_type := null;
      new.first_portal_access_at := null;
      new.last_portal_access_at := null;
      new.tuition_due_day := null;
      new.tuition_due_day_anchor_date := null;
      new.tuition_due_day_selected_at := null;
      new.tuition_first_due_date := null;
      new.tuition_due_day_source := null;
    elsif tg_op = 'UPDATE' then
      if coalesce(old.archived, false) = true then
        raise exception 'Esta conta foi encerrada e não pode ser reativada pelo portal.' using errcode = '42501';
      end if;

      new.email := old.email;
      new.created_at := old.created_at;
      new.enrollment_code := old.enrollment_code;
      new.enrolled := old.enrolled;
      new.exercise_schedule_start_date := old.exercise_schedule_start_date;
      new.archived := old.archived;
      new.archived_at := old.archived_at;
      new.class_type := old.class_type;
      new.first_portal_access_at := old.first_portal_access_at;
      new.last_portal_access_at := old.last_portal_access_at;
      new.tuition_due_day := old.tuition_due_day;
      new.tuition_due_day_anchor_date := old.tuition_due_day_anchor_date;
      new.tuition_due_day_selected_at := old.tuition_due_day_selected_at;
      new.tuition_first_due_date := old.tuition_first_due_date;
      new.tuition_due_day_source := old.tuition_due_day_source;
    end if;
  end if;

  return new;
end;
$function$;

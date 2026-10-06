-- Unify the first-tuition due-date rule across student and teacher-admin flows.
-- New first due dates are limited to enrollment day or the following day.
-- Existing configured students keep their current recurring due day and historical first due date
-- when billing settings are edited without changing that due day.

create or replace function public.calculate_tuition_due_day_options(target_anchor_date date)
returns smallint[]
language sql
immutable
security invoker
set search_path = ''
returns null on null input
as $function$
  select array[
    extract(day from target_anchor_date)::smallint,
    extract(day from (target_anchor_date + 1))::smallint
  ]::smallint[];
$function$;

revoke execute on function public.calculate_tuition_due_day_options(date)
  from public, anon, authenticated;
grant execute on function public.calculate_tuition_due_day_options(date)
  to service_role;

create or replace function public.get_teacher_student_tuition_due_date_options(
  target_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  profile_row public.profiles%rowtype;
  enrollment_date date;
  due_date_options date[];
  due_day_options smallint[];
begin
  if auth.uid() is null
     or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.'
      using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = target_student_id
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;

  if profile_row.id is null then
    raise exception 'Aluno matriculado não encontrado.';
  end if;

  enrollment_date := coalesce(
    timezone('America/Sao_Paulo', profile_row.enrolled_at)::date,
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  due_date_options :=
    private.get_enrollment_tuition_due_date_options(enrollment_date);

  select array_agg(
    extract(day from option_date)::smallint
    order by option_date
  )
  into due_day_options
  from unnest(due_date_options) option_date;

  return jsonb_build_object(
    'anchor_date', enrollment_date,
    'date_options', to_jsonb(due_date_options),
    'options', to_jsonb(due_day_options),
    'selected_due_day', profile_row.tuition_due_day,
    'selected_due_date', profile_row.tuition_first_due_date,
    'first_due_date', profile_row.tuition_first_due_date
  );
end;
$function$;

revoke execute on function public.get_teacher_student_tuition_due_date_options(uuid)
  from public, anon;
grant execute on function public.get_teacher_student_tuition_due_date_options(uuid)
  to authenticated, service_role;

create or replace function public.save_student_billing_settings__mfa_inner(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_due_day integer,
  target_billing_start_month date,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  existing_due_day smallint;
  existing_start_month date;
  enrollment_date date;
  due_date_options date[];
  current_due_day smallint;
  chosen_first_due_date date;
  system_start_month date;
  due_day_source text;
  first_tuition_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  if target_monthly_fee is null or target_monthly_fee <= 0 then
    raise exception 'Informe um valor mensal maior que zero.';
  end if;

  if target_due_day is null or target_due_day < 1 or target_due_day > 31 then
    raise exception 'Selecione um dia de vencimento válido.';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = target_student_id
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false
  for update;

  if profile_row.id is null then
    raise exception 'Aluno matriculado não encontrado.';
  end if;

  select settings.due_day, settings.billing_start_month
  into existing_due_day, existing_start_month
  from public.student_billing_settings settings
  where settings.student_id = target_student_id;

  enrollment_date := coalesce(
    timezone('America/Sao_Paulo', profile_row.enrolled_at)::date,
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  due_date_options :=
    private.get_enrollment_tuition_due_date_options(enrollment_date);
  current_due_day := coalesce(existing_due_day, profile_row.tuition_due_day);

  if target_due_day = current_due_day
     and profile_row.tuition_first_due_date is not null then
    chosen_first_due_date := profile_row.tuition_first_due_date;
    due_day_source := coalesce(profile_row.tuition_due_day_source, 'admin');
  else
    select min(option_date)
    into chosen_first_due_date
    from unnest(due_date_options) option_date
    where extract(day from option_date)::integer = target_due_day;

    if chosen_first_due_date is null then
      raise exception 'Escolha o vencimento no dia da matrícula ou no dia seguinte.';
    end if;

    due_day_source := 'admin';
  end if;

  system_start_month := date_trunc('month', chosen_first_due_date)::date;

  update public.profiles
  set
    tuition_due_day = target_due_day::smallint,
    tuition_due_day_anchor_date = enrollment_date,
    tuition_due_day_selected_at = case
      when tuition_due_day is distinct from target_due_day::smallint
        then now()
      else coalesce(tuition_due_day_selected_at, now())
    end,
    tuition_first_due_date = chosen_first_due_date,
    tuition_due_day_source = due_day_source
  where id = target_student_id;

  insert into public.student_billing_settings (
    student_id,
    monthly_fee,
    due_day,
    billing_start_month,
    active,
    notes,
    updated_at,
    updated_by
  )
  values (
    target_student_id,
    round(target_monthly_fee, 2),
    target_due_day::smallint,
    system_start_month,
    coalesce(target_active, true),
    nullif(trim(coalesce(target_notes, '')), ''),
    now(),
    auth.uid()
  )
  on conflict (student_id) do update
  set
    monthly_fee = excluded.monthly_fee,
    due_day = excluded.due_day,
    billing_start_month = excluded.billing_start_month,
    active = excluded.active,
    notes = excluded.notes,
    updated_at = now(),
    updated_by = auth.uid();

  if coalesce(target_active, true) then
    first_tuition_id := private.ensure_first_tuition_for_student(
      target_student_id,
      chosen_first_due_date
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'due_day', target_due_day,
    'first_due_date', chosen_first_due_date,
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', false,
    'first_tuition_id', first_tuition_id
  );
end;
$function$;

create or replace function public.save_student_billing_settings__mfa_inner(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  existing_due_day smallint;
  existing_start_month date;
  selected_due_day smallint;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = target_student_id
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;

  if profile_row.id is null then
    raise exception 'Aluno matriculado não encontrado.';
  end if;

  select settings.due_day, settings.billing_start_month
  into existing_due_day, existing_start_month
  from public.student_billing_settings settings
  where settings.student_id = target_student_id;

  selected_due_day := coalesce(existing_due_day, profile_row.tuition_due_day);

  if selected_due_day is null then
    raise exception 'Selecione um dia de vencimento antes de salvar a mensalidade.';
  end if;

  return public.save_student_billing_settings__mfa_inner(
    target_student_id,
    target_monthly_fee,
    selected_due_day::integer,
    coalesce(
      existing_start_month,
      date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date
    ),
    target_active,
    target_notes
  );
end;
$function$;

revoke execute on function public.save_student_billing_settings__mfa_inner(
  uuid, numeric, integer, date, boolean, text
) from public, anon, authenticated;
grant execute on function public.save_student_billing_settings__mfa_inner(
  uuid, numeric, integer, date, boolean, text
) to service_role;

revoke execute on function public.save_student_billing_settings__mfa_inner(
  uuid, numeric, boolean, text
) from public, anon, authenticated;
grant execute on function public.save_student_billing_settings__mfa_inner(
  uuid, numeric, boolean, text
) to service_role;

notify pgrst, 'reload schema';

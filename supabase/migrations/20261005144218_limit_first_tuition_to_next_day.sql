-- New enrollments can set the first tuition due date only to enrollment day or the following day.
-- Existing students with an already selected first due date are preserved.

create or replace function private.get_enrollment_tuition_due_date_options(
  target_enrollment_date date
)
returns date[]
language sql
immutable
security invoker
set search_path = ''
returns null on null input
as $function$
  select array[
    target_enrollment_date,
    target_enrollment_date + 1
  ]::date[];
$function$;

revoke execute on function private.get_enrollment_tuition_due_date_options(date)
  from public, anon, authenticated;
grant execute on function private.get_enrollment_tuition_due_date_options(date)
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
  due_date_options date[];
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

  due_date_options :=
    private.get_enrollment_tuition_due_date_options(enrollment_date);

  select array_agg(
    extract(day from option_date)::smallint
    order by option_date
  )
  into legacy_day_options
  from unnest(due_date_options) option_date;

  return jsonb_build_object(
    'anchor_date', enrollment_date,
    'date_options', to_jsonb(due_date_options),
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
  due_date_options date[];
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
        'billing_start_month',
          date_trunc('month', profile_row.tuition_first_due_date)::date,
        'already_selected', true,
        'auto_assigned', profile_row.tuition_due_day_source = 'system'
      );
    end if;

    raise exception 'O vencimento já foi escolhido para esta matrícula.';
  end if;

  due_date_options :=
    private.get_enrollment_tuition_due_date_options(enrollment_date);
  chosen_first_due_date := coalesce(target_due_date, enrollment_date);

  if not (chosen_first_due_date = any(due_date_options)) then
    raise exception 'Escolha o vencimento no dia da matrícula ou no dia seguinte.';
  end if;

  effective_due_day := extract(day from chosen_first_due_date)::smallint;
  due_day_source :=
    case when target_due_date is null then 'system' else 'student' end;
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
  due_date_options date[];
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
  due_date_options :=
    private.get_enrollment_tuition_due_date_options(enrollment_date);

  select min(option_date)
  into compatible_due_date
  from unnest(due_date_options) option_date
  where extract(day from option_date)::integer = target_due_day;

  if compatible_due_date is null then
    raise exception 'Escolha o vencimento no dia da matrícula ou no dia seguinte.';
  end if;

  return public.set_my_tuition_due_date(compatible_due_date);
end;
$function$;

revoke execute on function public.set_my_tuition_due_day(integer)
  from public, anon;
grant execute on function public.set_my_tuition_due_day(integer)
  to authenticated, service_role;

drop function if exists private.get_enrollment_tuition_schedule(uuid, date);

notify pgrst, 'reload schema';

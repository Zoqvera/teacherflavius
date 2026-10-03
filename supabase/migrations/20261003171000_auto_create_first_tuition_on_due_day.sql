create or replace function private.ensure_first_tuition_for_student(
  target_student_id uuid,
  target_first_due_date date
)
returns uuid
language plpgsql
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  billing_row public.student_billing_settings%rowtype;
  target_reference_month date;
  tuition_id uuid;
begin
  if target_student_id is null or target_first_due_date is null then
    return null;
  end if;

  select *
  into billing_row
  from public.student_billing_settings
  where student_id = target_student_id
    and active = true
    and monthly_fee is not null
    and monthly_fee > 0;

  if not found then
    return null;
  end if;

  target_reference_month := date_trunc('month', target_first_due_date)::date;

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
    select id
    into tuition_id
    from public.monthly_tuition
    where student_id = target_student_id
      and reference_month = target_reference_month;
  end if;

  return tuition_id;
end;
$function$;

revoke all on function private.ensure_first_tuition_for_student(uuid, date) from public, anon, authenticated;

create or replace function public.set_my_tuition_due_day(target_due_day integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  enrollment_date date;
  due_day_options smallint[];
  chosen_first_due_date date;
  effective_due_day smallint;
  due_day_source text;
  system_start_month date;
  auto_assigned boolean := false;
  first_tuition_id uuid;
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

  enrollment_date := coalesce(
    timezone('America/Sao_Paulo', profile_row.enrolled_at)::date,
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  due_day_options := public.calculate_tuition_due_day_options(enrollment_date);

  if profile_row.tuition_due_day is not null then
    if target_due_day is null or profile_row.tuition_due_day = target_due_day then
      chosen_first_due_date := case
        when profile_row.tuition_first_due_date is not null
         and profile_row.tuition_first_due_date > enrollment_date
          then profile_row.tuition_first_due_date
        else public.first_tuition_due_date_after(
          enrollment_date,
          profile_row.tuition_due_day
        )
      end;

      update public.profiles
      set
        tuition_due_day_anchor_date = enrollment_date,
        tuition_first_due_date = chosen_first_due_date
      where id = profile_row.id;

      update public.student_billing_settings
      set
        billing_start_month = date_trunc('month', chosen_first_due_date)::date,
        updated_at = now()
      where student_id = profile_row.id
        and billing_start_month < date_trunc('month', chosen_first_due_date)::date;

      first_tuition_id := private.ensure_first_tuition_for_student(
        profile_row.id,
        chosen_first_due_date
      );

      return jsonb_build_object(
        'ok', true,
        'due_day', profile_row.tuition_due_day,
        'first_due_date', chosen_first_due_date,
        'billing_start_month', date_trunc('month', chosen_first_due_date)::date,
        'already_selected', true,
        'auto_assigned', profile_row.tuition_due_day_source = 'system',
        'first_tuition_id', first_tuition_id
      );
    end if;

    raise exception 'O dia de vencimento já foi escolhido para esta matrícula.';
  end if;

  if target_due_day is null then
    chosen_first_due_date := enrollment_date + 7;
    effective_due_day := extract(day from chosen_first_due_date)::smallint;
    due_day_source := 'system';
    auto_assigned := true;
  else
    if not (target_due_day::smallint = any(due_day_options)) then
      raise exception 'Escolha uma das três opções de vencimento disponíveis.';
    end if;

    chosen_first_due_date := public.first_tuition_due_date_after(
      enrollment_date,
      target_due_day
    );
    effective_due_day := target_due_day::smallint;
    due_day_source := 'student';
  end if;

  system_start_month := date_trunc('month', chosen_first_due_date)::date;

  update public.profiles
  set
    tuition_due_day = effective_due_day,
    tuition_due_day_anchor_date = enrollment_date,
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

  first_tuition_id := private.ensure_first_tuition_for_student(
    auth.uid(),
    chosen_first_due_date
  );

  return jsonb_build_object(
    'ok', true,
    'due_day', effective_due_day,
    'first_due_date', chosen_first_due_date,
    'billing_start_month', system_start_month,
    'already_selected', false,
    'auto_assigned', auto_assigned,
    'first_tuition_id', first_tuition_id
  );
end;
$function$;
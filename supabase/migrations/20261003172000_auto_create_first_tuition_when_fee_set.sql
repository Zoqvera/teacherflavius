
create or replace function public.save_student_billing_settings__mfa_inner(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_active boolean,
  target_notes text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  existing_due_day smallint;
  existing_start_month date;
  selected_due_day smallint;
  system_start_month date;
  anchor_date date;
  first_tuition_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  if target_monthly_fee is null or target_monthly_fee <= 0 then
    raise exception 'Informe um valor mensal maior que zero.';
  end if;

  select p.*
  into profile_row
  from public.profiles p
  where p.id = target_student_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if profile_row.id is null then
    raise exception 'Aluno matriculado não encontrado.';
  end if;

  select s.due_day, s.billing_start_month
  into existing_due_day, existing_start_month
  from public.student_billing_settings s
  where s.student_id = target_student_id;

  selected_due_day := coalesce(existing_due_day, profile_row.tuition_due_day);

  if selected_due_day is null then
    raise exception 'Selecione um dia de vencimento antes de salvar a mensalidade.';
  end if;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  system_start_month := case
    when profile_row.tuition_due_day_source = 'legacy'
      and existing_start_month is not null
      then existing_start_month
    when profile_row.tuition_first_due_date is not null
      then date_trunc('month', profile_row.tuition_first_due_date)::date
    when existing_start_month is not null
      then existing_start_month
    else date_trunc('month', anchor_date)::date
  end;

  update public.profiles
  set
    tuition_due_day = selected_due_day,
    tuition_due_day_anchor_date = coalesce(tuition_due_day_anchor_date, anchor_date),
    tuition_due_day_selected_at = coalesce(tuition_due_day_selected_at, now()),
    tuition_due_day_source = coalesce(tuition_due_day_source, 'legacy')
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
  ) values (
    target_student_id,
    round(target_monthly_fee, 2),
    selected_due_day,
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

  if coalesce(target_active, true)
     and profile_row.tuition_first_due_date is not null then
    first_tuition_id := private.ensure_first_tuition_for_student(
      target_student_id,
      profile_row.tuition_first_due_date
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'due_day', selected_due_day,
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', false,
    'first_tuition_id', first_tuition_id
  );
end;
$function$;

create or replace function public.save_student_billing_settings__mfa_inner(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_due_day integer,
  target_billing_start_month date,
  target_active boolean,
  target_notes text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  profile_row public.profiles%rowtype;
  existing_due_day smallint;
  existing_start_month date;
  enrollment_date date;
  due_day_options smallint[];
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

  select p.*
  into profile_row
  from public.profiles p
  where p.id = target_student_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
  for update;

  if profile_row.id is null then
    raise exception 'Aluno matriculado não encontrado.';
  end if;

  select s.due_day, s.billing_start_month
  into existing_due_day, existing_start_month
  from public.student_billing_settings s
  where s.student_id = target_student_id;

  enrollment_date := coalesce(
    timezone('America/Sao_Paulo', profile_row.enrolled_at)::date,
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  due_day_options := public.calculate_tuition_due_day_options(enrollment_date);
  current_due_day := coalesce(existing_due_day, profile_row.tuition_due_day);

  if not (target_due_day::smallint = any(due_day_options))
     and target_due_day is distinct from current_due_day then
    raise exception 'Escolha uma das três opções de vencimento disponíveis.';
  end if;

  chosen_first_due_date := case
    when target_due_day = profile_row.tuition_due_day
     and profile_row.tuition_first_due_date is not null
     and profile_row.tuition_first_due_date > enrollment_date
      then profile_row.tuition_first_due_date
    else public.first_tuition_due_date_after(enrollment_date, target_due_day)
  end;

  due_day_source := case
    when target_due_day = profile_row.tuition_due_day
      and profile_row.tuition_due_day_source is not null
      then profile_row.tuition_due_day_source
    else 'admin'
  end;

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
  ) values (
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
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', false,
    'first_tuition_id', first_tuition_id
  );
end;
$function$;

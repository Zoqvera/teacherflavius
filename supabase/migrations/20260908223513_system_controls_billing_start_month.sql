create or replace function public.save_student_billing_settings(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  profile_row public.profiles%rowtype;
  existing_start_month date;
  system_start_month date;
  anchor_date date;
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

  select s.billing_start_month
  into existing_start_month
  from public.student_billing_settings s
  where s.student_id = target_student_id;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );

  system_start_month := case
    when profile_row.tuition_due_day_source = 'legacy' and existing_start_month is not null
      then existing_start_month
    when profile_row.tuition_first_due_date is not null
      then date_trunc('month', profile_row.tuition_first_due_date)::date
    else date_trunc('month', anchor_date)::date
  end;

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
    profile_row.tuition_due_day,
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

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'due_day', profile_row.tuition_due_day,
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', profile_row.tuition_due_day is null
  );
end;
$$;

create or replace function public.save_student_billing_settings(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_billing_start_month date,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  return public.save_student_billing_settings(
    target_student_id,
    target_monthly_fee,
    target_active,
    target_notes
  );
end;
$$;

create or replace function public.save_student_billing_settings(
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
set search_path to 'public', 'pg_temp'
as $$
begin
  return public.save_student_billing_settings(
    target_student_id,
    target_monthly_fee,
    target_active,
    target_notes
  );
end;
$$;

create or replace function public.set_my_tuition_due_day(target_due_day integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  profile_row public.profiles%rowtype;
  anchor_date date;
  due_day_options smallint[];
  chosen_first_due_date date;
  system_start_month date;
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
    if profile_row.tuition_due_day = target_due_day then
      return jsonb_build_object(
        'ok', true,
        'due_day', profile_row.tuition_due_day,
        'first_due_date', profile_row.tuition_first_due_date,
        'billing_start_month', case
          when profile_row.tuition_first_due_date is not null
            then date_trunc('month', profile_row.tuition_first_due_date)::date
          else date_trunc('month', anchor_date)::date
        end,
        'already_selected', true
      );
    end if;

    raise exception 'O dia de vencimento já foi escolhido para esta matrícula.';
  end if;

  if target_due_day is null or not (target_due_day::smallint = any(due_day_options)) then
    raise exception 'Escolha uma das três opções de vencimento disponíveis.';
  end if;

  chosen_first_due_date := case
    when target_due_day = extract(day from anchor_date)::integer then anchor_date
    when target_due_day = extract(day from (anchor_date + 5))::integer then anchor_date + 5
    when target_due_day = extract(day from (anchor_date + 8))::integer then anchor_date + 8
    else null
  end;
  system_start_month := date_trunc('month', chosen_first_due_date)::date;

  update public.profiles
  set
    tuition_due_day = target_due_day::smallint,
    tuition_due_day_anchor_date = anchor_date,
    tuition_due_day_selected_at = now(),
    tuition_first_due_date = chosen_first_due_date,
    tuition_due_day_source = 'student'
  where id = auth.uid();

  update public.student_billing_settings
  set
    due_day = target_due_day::smallint,
    billing_start_month = system_start_month,
    updated_at = now()
  where student_id = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'due_day', target_due_day,
    'first_due_date', chosen_first_due_date,
    'billing_start_month', system_start_month,
    'already_selected', false
  );
end;
$$;

grant execute on function public.save_student_billing_settings(uuid, numeric, boolean, text) to authenticated;
grant execute on function public.save_student_billing_settings(uuid, numeric, date, boolean, text) to authenticated;
grant execute on function public.save_student_billing_settings(uuid, numeric, integer, date, boolean, text) to authenticated;
grant execute on function public.set_my_tuition_due_day(integer) to authenticated;

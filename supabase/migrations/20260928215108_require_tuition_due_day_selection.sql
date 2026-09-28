-- Require every configured monthly tuition to have an explicit due day.
-- Existing billing values remain authoritative during the transition. Future
-- administrative selections must follow the same three-option rule used by
-- student onboarding: anchor day, anchor + 5 days, or anchor + 8 days.

update public.profiles p
set
  tuition_due_day = s.due_day,
  tuition_due_day_anchor_date = coalesce(
    p.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', p.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  ),
  tuition_due_day_selected_at = coalesce(
    p.tuition_due_day_selected_at,
    s.updated_at,
    s.created_at,
    now()
  ),
  tuition_first_due_date = null,
  tuition_due_day_source = 'legacy'
from public.student_billing_settings s
where s.student_id = p.id
  and s.due_day is not null
  and p.tuition_due_day is distinct from s.due_day;

alter table public.profiles
  drop constraint if exists profiles_tuition_due_day_source_check;

alter table public.profiles
  add constraint profiles_tuition_due_day_source_check
  check (
    tuition_due_day_source is null
    or tuition_due_day_source in ('student', 'admin', 'legacy')
  );

do $$
begin
  if exists (
    select 1
    from public.student_billing_settings
    where due_day is null
  ) then
    raise exception 'Existem mensalidades configuradas sem dia de vencimento.';
  end if;
end;
$$;

alter table public.student_billing_settings
  alter column due_day set not null;

create or replace function public.get_teacher_billing_students__mfa_inner()
returns table(
  student_id uuid,
  name text,
  email text,
  monthly_fee numeric,
  due_day smallint,
  billing_start_month date,
  billing_active boolean,
  billing_notes text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  return query
  select
    p.id,
    coalesce(p.name, '')::text,
    coalesce(p.email, '')::text,
    s.monthly_fee,
    coalesce(s.due_day, p.tuition_due_day)::smallint,
    s.billing_start_month,
    s.active,
    coalesce(s.notes, '')::text
  from public.profiles p
  left join public.student_billing_settings s on s.student_id = p.id
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and not exists (
      select 1
      from public.teacher_admins ta
      where ta.user_id = p.id
         or lower(ta.email) = lower(coalesce(p.email, ''))
    )
  order by p.name asc nulls last, p.email asc nulls last;
end;
$$;

create or replace function public.save_student_billing_settings__mfa_inner(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  existing_due_day smallint;
  existing_start_month date;
  selected_due_day smallint;
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

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'due_day', selected_due_day,
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', false
  );
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  existing_due_day smallint;
  existing_start_month date;
  anchor_date date;
  due_day_options smallint[];
  current_due_day smallint;
  chosen_first_due_date date;
  system_start_month date;
  due_day_source text;
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

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', profile_row.created_at)::date,
    timezone('America/Sao_Paulo', now())::date
  );
  due_day_options := public.calculate_tuition_due_day_options(anchor_date);
  current_due_day := coalesce(existing_due_day, profile_row.tuition_due_day);

  if not (target_due_day::smallint = any(due_day_options))
     and target_due_day is distinct from current_due_day then
    raise exception 'Escolha uma das três opções de vencimento disponíveis.';
  end if;

  chosen_first_due_date := case
    when target_due_day = extract(day from anchor_date)::integer
      then anchor_date
    when target_due_day = extract(day from (anchor_date + 5))::integer
      then anchor_date + 5
    when target_due_day = extract(day from (anchor_date + 8))::integer
      then anchor_date + 8
    when target_due_day = profile_row.tuition_due_day
      then profile_row.tuition_first_due_date
    else null
  end;

  due_day_source := case
    when target_due_day = profile_row.tuition_due_day
      and profile_row.tuition_due_day_source is not null
      then profile_row.tuition_due_day_source
    else 'admin'
  end;

  system_start_month := case
    when current_due_day is not null
      and target_due_day = current_due_day
      and existing_start_month is not null
      then existing_start_month
    when chosen_first_due_date is not null
      then date_trunc('month', chosen_first_due_date)::date
    when existing_start_month is not null
      then existing_start_month
    else date_trunc('month', anchor_date)::date
  end;

  update public.profiles
  set
    tuition_due_day = target_due_day::smallint,
    tuition_due_day_anchor_date = anchor_date,
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

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'due_day', target_due_day,
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', false
  );
end;
$$;

revoke all on function public.save_student_billing_settings__mfa_inner(uuid,numeric,boolean,text)
  from public, anon, authenticated;
revoke all on function public.save_student_billing_settings__mfa_inner(uuid,numeric,integer,date,boolean,text)
  from public, anon, authenticated;

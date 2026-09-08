alter table public.profiles
  add column if not exists tuition_due_day smallint,
  add column if not exists tuition_due_day_anchor_date date,
  add column if not exists tuition_due_day_selected_at timestamptz,
  add column if not exists tuition_first_due_date date,
  add column if not exists tuition_due_day_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_tuition_due_day_check'
  ) then
    alter table public.profiles
      add constraint profiles_tuition_due_day_check
      check (tuition_due_day is null or tuition_due_day between 1 and 31);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_tuition_due_day_source_check'
  ) then
    alter table public.profiles
      add constraint profiles_tuition_due_day_source_check
      check (tuition_due_day_source is null or tuition_due_day_source in ('student', 'legacy'));
  end if;
end $$;

alter table public.student_billing_settings
  alter column due_day drop not null;

update public.profiles p
set
  tuition_due_day = s.due_day,
  tuition_due_day_anchor_date = coalesce(
    p.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', p.created_at)::date
  ),
  tuition_due_day_selected_at = coalesce(
    p.tuition_due_day_selected_at,
    s.updated_at,
    s.created_at,
    p.created_at,
    now()
  ),
  tuition_due_day_source = coalesce(p.tuition_due_day_source, 'legacy')
from public.student_billing_settings s
where s.student_id = p.id
  and s.due_day is not null
  and p.tuition_due_day is null;

create or replace function public.calculate_tuition_due_day_options(target_anchor_date date)
returns smallint[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    extract(day from target_anchor_date)::smallint,
    extract(day from (target_anchor_date + 5))::smallint,
    extract(day from (target_anchor_date + 8))::smallint
  ];
$$;

revoke execute on function public.calculate_tuition_due_day_options(date)
  from public, anon, authenticated;

create or replace function public.get_my_tuition_due_day_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke execute on function public.get_my_tuition_due_day_options() from public, anon;
grant execute on function public.get_my_tuition_due_day_options() to authenticated;

create or replace function public.set_my_tuition_due_day(target_due_day integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  anchor_date date;
  due_day_options smallint[];
  chosen_first_due_date date;
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
    updated_at = now()
  where student_id = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'due_day', target_due_day,
    'first_due_date', chosen_first_due_date,
    'already_selected', false
  );
end;
$$;

revoke execute on function public.set_my_tuition_due_day(integer) from public, anon;
grant execute on function public.set_my_tuition_due_day(integer) to authenticated;

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
set search_path = public, pg_temp
as $$
declare
  normalized_start_month date;
  selected_due_day smallint;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  if target_monthly_fee is null or target_monthly_fee <= 0 then
    raise exception 'Informe um valor mensal maior que zero.';
  end if;

  select p.tuition_due_day
  into selected_due_day
  from public.profiles p
  where p.id = target_student_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if not found then
    raise exception 'Aluno matriculado não encontrado.';
  end if;

  normalized_start_month := date_trunc(
    'month',
    coalesce(target_billing_start_month, current_date)
  )::date;

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
    normalized_start_month,
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
    'awaiting_student_due_day', selected_due_day is null
  );
end;
$$;

revoke execute on function public.save_student_billing_settings(uuid,numeric,date,boolean,text)
  from public, anon;
grant execute on function public.save_student_billing_settings(uuid,numeric,date,boolean,text)
  to authenticated;

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
set search_path = public, pg_temp
as $$
begin
  return public.save_student_billing_settings(
    target_student_id,
    target_monthly_fee,
    target_billing_start_month,
    target_active,
    target_notes
  );
end;
$$;

create or replace function public.get_teacher_billing_students()
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
    coalesce(p.tuition_due_day, s.due_day)::smallint,
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

create or replace function public.generate_monthly_tuition(target_reference_month date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_reference_month date;
  affected_count integer := 0;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  normalized_reference_month := date_trunc(
    'month',
    coalesce(target_reference_month, current_date)
  )::date;

  insert into public.monthly_tuition (
    student_id,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  )
  select
    s.student_id,
    generated_month.reference_month::date,
    make_date(
      extract(year from generated_month.reference_month)::integer,
      extract(month from generated_month.reference_month)::integer,
      least(
        s.due_day::integer,
        extract(
          day from (
            date_trunc('month', generated_month.reference_month)
            + interval '1 month - 1 day'
          )
        )::integer
      )
    ),
    s.monthly_fee,
    auth.uid(),
    auth.uid()
  from public.student_billing_settings s
  join public.profiles p on p.id = s.student_id
  cross join lateral generate_series(
    s.billing_start_month::timestamp,
    normalized_reference_month::timestamp,
    interval '1 month'
  ) as generated_month(reference_month)
  where s.active = true
    and s.due_day is not null
    and s.billing_start_month <= normalized_reference_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = excluded.amount_due,
    updated_at = now(),
    updated_by = auth.uid()
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      public.monthly_tuition.due_date is distinct from excluded.due_date
      or public.monthly_tuition.amount_due is distinct from excluded.amount_due
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
$$;

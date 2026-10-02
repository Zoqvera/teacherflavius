-- Ensure that no open tuition can be due on or before the student's enrollment date.
-- Existing settled/exempt historical rows are preserved.

alter table public.profiles
  add column if not exists enrolled_at timestamptz;

comment on column public.profiles.enrolled_at is
  'Momento efetivo da matrícula. Novas matrículas são registradas automaticamente; registros legados são inferidos uma única vez.';

with first_notification as (
  select student_id, min(created_at) as event_at
  from public.enrollment_email_notifications
  group by student_id
),
backfill as (
  select
    p.id,
    coalesce(
      case
        when n.event_at is not null
         and abs(
           timezone('America/Sao_Paulo', n.event_at)::date
           - timezone('America/Sao_Paulo', p.created_at)::date
         ) <= 1
          then n.event_at
        else null
      end,
      p.created_at,
      now()
    ) as inferred_enrolled_at
  from public.profiles p
  left join first_notification n on n.student_id = p.id
  where coalesce(p.enrolled, false) = true
    and p.enrolled_at is null
)
update public.profiles p
set enrolled_at = b.inferred_enrolled_at
from backfill b
where p.id = b.id;

-- The business enrollment date for Bruna Brito was confirmed administratively.
update public.profiles
set enrolled_at = timestamptz '2026-09-27 00:00:00-03'
where id = 'fa6d29fe-b63f-42da-9673-327debd78079'
  and name = 'Bruna Brito';

create or replace function public.first_tuition_due_date_after(
  target_enrollment_date date,
  target_due_day integer
)
returns date
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  current_month date;
  next_month date;
  current_candidate date;
begin
  if target_enrollment_date is null then
    return null;
  end if;

  if target_due_day is null or target_due_day < 1 or target_due_day > 31 then
    raise exception 'Dia de vencimento inválido.';
  end if;

  current_month := date_trunc('month', target_enrollment_date)::date;
  current_candidate := make_date(
    extract(year from current_month)::integer,
    extract(month from current_month)::integer,
    least(
      target_due_day,
      extract(
        day from (
          date_trunc('month', current_month)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  );

  if current_candidate > target_enrollment_date then
    return current_candidate;
  end if;

  next_month := (current_month + interval '1 month')::date;

  return make_date(
    extract(year from next_month)::integer,
    extract(month from next_month)::integer,
    least(
      target_due_day,
      extract(
        day from (
          date_trunc('month', next_month)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  );
end;
$function$;

revoke all on function public.first_tuition_due_date_after(date, integer)
  from public, anon, authenticated;

create or replace function public.set_profile_enrolled_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(new.enrolled, false) = true
     and new.enrolled_at is null then
    new.enrolled_at := now();
  end if;

  return new;
end;
$function$;

revoke all on function public.set_profile_enrolled_at()
  from public, anon, authenticated;

drop trigger if exists zzzz_set_profile_enrolled_at_before_write
  on public.profiles;

create trigger zzzz_set_profile_enrolled_at_before_write
before insert or update on public.profiles
for each row
execute function public.set_profile_enrolled_at();

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
      new.enrolled_at := null;
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
        raise exception 'Esta conta foi encerrada e não pode ser reativada pelo portal.'
          using errcode = '42501';
      end if;

      new.email := old.email;
      new.created_at := old.created_at;
      new.enrollment_code := old.enrollment_code;
      new.enrolled := old.enrolled;
      new.enrolled_at := old.enrolled_at;
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

      return jsonb_build_object(
        'ok', true,
        'due_day', profile_row.tuition_due_day,
        'first_due_date', chosen_first_due_date,
        'billing_start_month', date_trunc('month', chosen_first_due_date)::date,
        'already_selected', true,
        'auto_assigned', profile_row.tuition_due_day_source = 'system'
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

revoke execute on function public.set_my_tuition_due_day(integer)
  from public, anon;
grant execute on function public.set_my_tuition_due_day(integer)
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

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'due_day', target_due_day,
    'billing_start_month', system_start_month,
    'awaiting_student_due_day', false
  );
end;
$function$;

create or replace function public.generate_monthly_tuition__mfa_inner(
  target_reference_month date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
    calculated_due.due_date,
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
  cross join lateral (
    select make_date(
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
    ) as due_date
  ) calculated_due
  where s.active = true
    and s.due_day is not null
    and s.billing_start_month <= normalized_reference_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and calculated_due.due_date > coalesce(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      timezone('America/Sao_Paulo', p.created_at)::date
    )
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = coalesce(
      public.monthly_tuition.amount_override,
      excluded.amount_due
    ),
    updated_at = now(),
    updated_by = auth.uid()
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      public.monthly_tuition.due_date is distinct from excluded.due_date
      or (
        public.monthly_tuition.amount_override is null
        and public.monthly_tuition.amount_due is distinct from excluded.amount_due
      )
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$;

create or replace function public.prepare_next_tuition_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  settings_row public.student_billing_settings%rowtype;
  enrollment_date date;
  next_reference_month date;
  next_due_date date;
begin
  if new.payment_date is null or new.student_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.payment_date is not distinct from new.payment_date then
    return new;
  end if;

  select settings.*
  into settings_row
  from public.student_billing_settings settings
  join public.profiles profile on profile.id = settings.student_id
  where settings.student_id = new.student_id
    and settings.active = true
    and settings.due_day is not null
    and settings.monthly_fee > 0
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;

  if not found then
    return new;
  end if;

  select coalesce(
    timezone('America/Sao_Paulo', p.enrolled_at)::date,
    timezone('America/Sao_Paulo', p.created_at)::date
  )
  into enrollment_date
  from public.profiles p
  where p.id = new.student_id;

  next_reference_month := (
    date_trunc('month', new.reference_month::timestamp)
    + interval '1 month'
  )::date;

  if next_reference_month < settings_row.billing_start_month then
    next_reference_month := settings_row.billing_start_month;
  end if;

  next_due_date := make_date(
    extract(year from next_reference_month)::integer,
    extract(month from next_reference_month)::integer,
    least(
      settings_row.due_day::integer,
      extract(
        day from (
          date_trunc('month', next_reference_month)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  );

  if next_due_date <= enrollment_date then
    next_due_date := public.first_tuition_due_date_after(
      enrollment_date,
      settings_row.due_day
    );
    next_reference_month := date_trunc('month', next_due_date)::date;
  end if;

  insert into public.monthly_tuition (
    student_id,
    subject_ref,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  ) values (
    new.student_id,
    coalesce(new.subject_ref, new.student_id),
    next_reference_month,
    next_due_date,
    round(settings_row.monthly_fee, 2),
    null,
    null
  )
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = coalesce(
      public.monthly_tuition.amount_override,
      excluded.amount_due
    ),
    updated_at = now(),
    updated_by = null
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      public.monthly_tuition.due_date is distinct from excluded.due_date
      or (
        public.monthly_tuition.amount_override is null
        and public.monthly_tuition.amount_due is distinct from excluded.amount_due
      )
    );

  return new;
end;
$function$;

-- Repair schedules that are currently invalid. Settled history is retained.
with invalid_schedule as (
  select
    p.id,
    public.first_tuition_due_date_after(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      s.due_day
    ) as corrected_first_due
  from public.profiles p
  join public.student_billing_settings s on s.student_id = p.id
  where p.enrolled_at is not null
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and s.due_day is not null
    and (
      (
        p.tuition_first_due_date is not null
        and p.tuition_first_due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
      )
      or exists (
        select 1
        from public.monthly_tuition mt
        where mt.student_id = p.id
          and mt.payment_date is null
          and not mt.is_exempt
          and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
      )
    )
)
update public.student_billing_settings s
set
  billing_start_month = date_trunc('month', invalid_schedule.corrected_first_due)::date,
  updated_at = now()
from invalid_schedule
where s.student_id = invalid_schedule.id
  and s.billing_start_month < date_trunc('month', invalid_schedule.corrected_first_due)::date;

with invalid_schedule as (
  select
    p.id,
    public.first_tuition_due_date_after(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      s.due_day
    ) as corrected_first_due
  from public.profiles p
  join public.student_billing_settings s on s.student_id = p.id
  where p.enrolled_at is not null
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and s.due_day is not null
    and (
      (
        p.tuition_first_due_date is not null
        and p.tuition_first_due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
      )
      or exists (
        select 1
        from public.monthly_tuition mt
        where mt.student_id = p.id
          and mt.payment_date is null
          and not mt.is_exempt
          and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
      )
    )
)
update public.profiles p
set
  tuition_due_day_anchor_date = timezone('America/Sao_Paulo', p.enrolled_at)::date,
  tuition_first_due_date = invalid_schedule.corrected_first_due
from invalid_schedule
where p.id = invalid_schedule.id;

do $repair_guard$
begin
  if exists (
    select 1
    from public.monthly_tuition mt
    join public.profiles p on p.id = mt.student_id
    join public.student_billing_settings s on s.student_id = mt.student_id
    cross join lateral (
      select public.first_tuition_due_date_after(
        timezone('America/Sao_Paulo', p.enrolled_at)::date,
        s.due_day
      ) as corrected_due
    ) corrected
    where mt.payment_date is null
      and not mt.is_exempt
      and p.enrolled_at is not null
      and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
      and exists (
        select 1
        from public.monthly_tuition target
        where target.student_id = mt.student_id
          and target.id <> mt.id
          and target.reference_month = date_trunc('month', corrected.corrected_due)::date
      )
  ) then
    raise exception 'Existe conflito de referência mensal ao corrigir mensalidades anteriores à matrícula.';
  end if;
end;
$repair_guard$;

with invalid_open_tuition as (
  select
    mt.id,
    public.first_tuition_due_date_after(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      s.due_day
    ) as corrected_due
  from public.monthly_tuition mt
  join public.profiles p on p.id = mt.student_id
  join public.student_billing_settings s on s.student_id = mt.student_id
  where mt.payment_date is null
    and not mt.is_exempt
    and p.enrolled_at is not null
    and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
)
update public.monthly_tuition mt
set
  due_date = invalid.corrected_due,
  reference_month = date_trunc('month', invalid.corrected_due)::date,
  updated_at = now()
from invalid_open_tuition invalid
where mt.id = invalid.id;

create or replace function public.reject_open_tuition_before_enrollment()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  enrollment_date date;
begin
  if new.student_id is null
     or new.payment_date is not null
     or coalesce(new.is_exempt, false) then
    return new;
  end if;

  select coalesce(
    timezone('America/Sao_Paulo', p.enrolled_at)::date,
    timezone('America/Sao_Paulo', p.created_at)::date
  )
  into enrollment_date
  from public.profiles p
  where p.id = new.student_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if enrollment_date is not null
     and new.due_date <= enrollment_date then
    raise exception
      'O vencimento da mensalidade deve ser posterior à data de matrícula.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.reject_open_tuition_before_enrollment()
  from public, anon, authenticated;

drop trigger if exists monthly_tuition_reject_pre_enrollment_due
  on public.monthly_tuition;

create trigger monthly_tuition_reject_pre_enrollment_due
before insert or update of student_id, due_date, payment_date, is_exempt
on public.monthly_tuition
for each row
execute function public.reject_open_tuition_before_enrollment();

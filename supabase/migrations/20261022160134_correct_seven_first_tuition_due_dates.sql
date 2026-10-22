
-- Targeted billing schedule correction (seven active students enrolled in September 2026).
-- Preserve all payment records and amounts. First due = enrollment + 2 days.
-- Second due = first due + 30 days; later due dates follow the second due's
-- day of month, at monthly intervals. Do not change other students.
create table if not exists private.student_billing_due_date_overrides (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  first_reference_month date not null,
  first_due_date date not null,
  second_due_date date not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint student_billing_due_overrides_interval_check
    check (second_due_date = first_due_date + 30),
  constraint student_billing_due_overrides_reference_check
    check (first_reference_month = date_trunc('month', first_reference_month)::date)
);

alter table private.student_billing_due_date_overrides enable row level security;
revoke all on private.student_billing_due_date_overrides from public, anon, authenticated;

create or replace function private.resolve_student_tuition_due_date(
  target_student_id uuid,
  target_reference_month date,
  fallback_due_date date
)
returns date
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  schedule_row private.student_billing_due_date_overrides%rowtype;
  billing_period integer;
begin
  select override_row.*
    into schedule_row
  from private.student_billing_due_date_overrides as override_row
  where override_row.student_id = target_student_id;

  if not found then
    return fallback_due_date;
  end if;

  billing_period :=
    (extract(year from target_reference_month)::integer
      - extract(year from schedule_row.first_reference_month)::integer) * 12
    + extract(month from target_reference_month)::integer
    - extract(month from schedule_row.first_reference_month)::integer;

  if billing_period = 0 then
    return schedule_row.first_due_date;
  end if;

  if billing_period > 0 then
    return (
      schedule_row.second_due_date
      + make_interval(months => billing_period - 1)
    )::date;
  end if;

  return fallback_due_date;
end;
$function$;

revoke all on function private.resolve_student_tuition_due_date(uuid,date,date)
  from public, anon, authenticated;

create or replace function private.apply_student_due_date_override()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.due_date := private.resolve_student_tuition_due_date(
    new.student_id,
    new.reference_month,
    new.due_date
  );
  return new;
end;
$function$;

revoke all on function private.apply_student_due_date_override()
  from public, anon, authenticated;

drop trigger if exists apply_student_due_date_override on public.monthly_tuition;
create trigger apply_student_due_date_override
before insert or update of student_id, reference_month, due_date
on public.monthly_tuition
for each row execute function private.apply_student_due_date_override();

-- Reuse the current production implementations, extending only their date
-- resolution to account for the seven individualized billing schedules.

CREATE OR REPLACE FUNCTION public.generate_monthly_tuition__mfa_inner(target_reference_month date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    effective_due.due_date,
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
    ) as recurring_due_date
  ) calculated_due
  cross join lateral (
    select private.resolve_student_tuition_due_date(
      s.student_id,
      generated_month.reference_month::date,
      case
        when generated_month.reference_month::date = s.billing_start_month
         and p.tuition_first_due_date is not null
          then p.tuition_first_due_date
        else calculated_due.recurring_due_date
      end::date
    ) as due_date
  ) effective_due
  where s.active = true
    and s.due_day is not null
    and s.billing_start_month <= normalized_reference_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and effective_due.due_date >= coalesce(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      timezone('America/Sao_Paulo', p.created_at)::date
    )
    and (
      exists (
        select 1
        from public.monthly_tuition existing_reference
        where existing_reference.student_id = s.student_id
          and existing_reference.reference_month = generated_month.reference_month::date
      )
      or not exists (
        select 1
        from public.monthly_tuition conflicting_due
        where conflicting_due.student_id = s.student_id
          and conflicting_due.due_date = effective_due.due_date
          and conflicting_due.reference_month <> generated_month.reference_month::date
      )
    )
  on conflict (student_id, reference_month) do update
  set
    due_date = case
      when exists (
        select 1
        from public.monthly_tuition conflicting_due
        where conflicting_due.student_id = excluded.student_id
          and conflicting_due.due_date = excluded.due_date
          and conflicting_due.id <> public.monthly_tuition.id
      )
        then public.monthly_tuition.due_date
      else excluded.due_date
    end,
    amount_due = coalesce(
      public.monthly_tuition.amount_override,
      excluded.amount_due
    ),
    updated_at = now(),
    updated_by = auth.uid()
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      (
        public.monthly_tuition.due_date is distinct from excluded.due_date
        and not exists (
          select 1
          from public.monthly_tuition conflicting_due
          where conflicting_due.student_id = excluded.student_id
            and conflicting_due.due_date = excluded.due_date
            and conflicting_due.id <> public.monthly_tuition.id
        )
      )
      or (
        public.monthly_tuition.amount_override is null
        and public.monthly_tuition.amount_due is distinct from excluded.amount_due
      )
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_next_tuition_after_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  next_due_date := private.resolve_student_tuition_due_date(
    new.student_id,
    next_reference_month,
    next_due_date
  );

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
$function$
;

CREATE OR REPLACE FUNCTION private.ensure_next_tuition_after_billing_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_reference_month date :=
    date_trunc('month', timezone('America/Sao_Paulo', now()))::date;
  last_paid_reference_month date;
  last_paid_subject_ref uuid;
  next_reference_month date;
  next_due_date date;
  enrolled_on date;
  first_due_date date;
begin
  if new.active is not true
     or new.due_day is null
     or new.monthly_fee <= 0 then
    return new;
  end if;

  select
    coalesce(
      timezone('America/Sao_Paulo', profile.enrolled_at)::date,
      timezone('America/Sao_Paulo', profile.created_at)::date
    ),
    profile.tuition_first_due_date
  into enrolled_on, first_due_date
  from public.profiles as profile
  where profile.id = new.student_id
    and profile.enrolled is true
    and profile.archived is false;

  if not found then
    return new;
  end if;

  -- Respect paused courses and permanent billing exemptions.
  if exists (
    select 1
    from public.student_course_states as course
    where course.student_id = new.student_id
      and (
        course.course_status = 'paused'
        or course.billing_exemption = 'permanent'
      )
  ) then
    return new;
  end if;

  -- Prevent old payments from generating historical charges on plan changes.
  select tuition.reference_month, tuition.subject_ref
  into last_paid_reference_month, last_paid_subject_ref
  from public.monthly_tuition as tuition
  where tuition.student_id = new.student_id
    and tuition.payment_date is not null
    and tuition.is_exempt is false
    and tuition.reference_month >=
      (current_reference_month - interval '1 month')::date
  order by tuition.reference_month desc
  limit 1;

  if not found then
    return new;
  end if;

  next_reference_month :=
    (last_paid_reference_month + interval '1 month')::date;

  if next_reference_month < current_reference_month
     or next_reference_month < new.billing_start_month then
    return new;
  end if;

  next_due_date := make_date(
    extract(year from next_reference_month)::integer,
    extract(month from next_reference_month)::integer,
    least(
      new.due_day::integer,
      extract(day from (
        date_trunc('month', next_reference_month)
        + interval '1 month - 1 day'
      ))::integer
    )
  );

  if next_reference_month = new.billing_start_month
     and first_due_date is not null then
    next_due_date := first_due_date;
  end if;

  next_due_date := private.resolve_student_tuition_due_date(
    new.student_id,
    next_reference_month,
    next_due_date
  );

  if next_due_date < enrolled_on then
    return new;
  end if;

  insert into public.monthly_tuition (
    student_id,
    subject_ref,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  )
  select
    new.student_id,
    coalesce(last_paid_subject_ref, new.student_id),
    next_reference_month,
    next_due_date,
    round(new.monthly_fee, 2),
    null,
    null
  where not exists (
    select 1
    from public.monthly_tuition as existing
    where existing.student_id = new.student_id
      and (
        existing.reference_month = next_reference_month
        or existing.due_date = next_due_date
      )
  )
  on conflict do nothing;

  return new;
end;
$function$
;

-- Store the override by stable profile identity resolved from an exact name
-- and local enrollment date, rather than embedding generated UUIDs.
create temporary table tf_seven_tuition_corrections on commit drop as
select
  profile.id as student_id,
  profile.name,
  expected.enrolled_on,
  date_trunc('month', expected.enrolled_on)::date as first_reference_month,
  (expected.enrolled_on + 2) as first_due_date,
  (expected.enrolled_on + 32) as second_due_date
from public.profiles as profile
join (
  values
    ('Sophia Victoria'::text, date '2026-09-30'),
    ('Ana Clara Oliveira Ramos', date '2026-09-25'),
    ('Évelyn Dos Santos', date '2026-09-25'),
    ('Andréia Pampolim', date '2026-09-24'),
    ('Beatriz Fernandes', date '2026-09-24'),
    ('Micheli Cristina Oliveira Rocha', date '2026-09-22'),
    ('Isabele Gonçalves', date '2026-09-15')
) as expected(name, enrolled_on)
  on profile.name = expected.name
 and timezone('America/Sao_Paulo', profile.enrolled_at)::date = expected.enrolled_on
where profile.enrolled is true
  and profile.archived is false
  and profile.tuition_due_day_source = 'student'
  and profile.tuition_first_due_date =
    (expected.enrolled_on + interval '1 month')::date;

do $check$
declare
  student_count integer;
  tuition_count integer;
begin
  select count(*) into student_count from tf_seven_tuition_corrections;
  if student_count <> 7 then
    raise exception 'Expected exactly 7 eligible active student profiles; found %', student_count;
  end if;
  select count(*) into tuition_count
  from public.monthly_tuition as tuition
  join tf_seven_tuition_corrections as target
    on target.student_id = tuition.student_id;
  if tuition_count <> 15 then
    raise exception 'Existing tuition records changed before correction: expected 15, found %',
      tuition_count;
  end if;
end;
$check$;

insert into private.student_billing_due_date_overrides (
  student_id, first_reference_month, first_due_date, second_due_date, reason
)
select student_id, first_reference_month, first_due_date, second_due_date,
  'Correção administrativa solicitada em 22/10/2026: primeira mensalidade dois dias após a matrícula e segunda 30 dias depois.'
from tf_seven_tuition_corrections;

update public.profiles as profile
set
  tuition_first_due_date = target.first_due_date,
  tuition_due_day = extract(day from target.second_due_date)::smallint,
  tuition_due_day_source = 'admin',
  tuition_due_day_selected_at = now()
from tf_seven_tuition_corrections as target
where profile.id = target.student_id;

update public.student_billing_settings as settings
set
  due_day = extract(day from target.second_due_date)::smallint,
  billing_start_month = target.first_reference_month,
  updated_at = now(),
  updated_by = null
from tf_seven_tuition_corrections as target
where settings.student_id = target.student_id;

insert into public.monthly_tuition_events (
  tuition_id, action, actor_id, details
)
select
  tuition.id,
  'due_date_corrected_after_enrollment',
  null,
  jsonb_build_object(
    'reason', 'Solicitação administrativa de 22/10/2026',
    'previous_due_date', tuition.due_date,
    'corrected_due_date', private.resolve_student_tuition_due_date(
      tuition.student_id, tuition.reference_month, tuition.due_date
    ),
    'payment_record_preserved', tuition.payment_date is not null,
    'reference_month', tuition.reference_month
  )
from public.monthly_tuition as tuition
join tf_seven_tuition_corrections as target
  on target.student_id = tuition.student_id
where tuition.due_date is distinct from private.resolve_student_tuition_due_date(
  tuition.student_id, tuition.reference_month, tuition.due_date
);

update public.monthly_tuition as tuition
set
  due_date = private.resolve_student_tuition_due_date(
    tuition.student_id, tuition.reference_month, tuition.due_date
  ),
  updated_at = now()
from tf_seven_tuition_corrections as target
where tuition.student_id = target.student_id
  and tuition.due_date is distinct from private.resolve_student_tuition_due_date(
    tuition.student_id, tuition.reference_month, tuition.due_date
  );

do $check$
declare
  corrected_count integer;
  mismatch_count integer;
begin
  select count(*) into corrected_count
  from public.monthly_tuition_events as event
  join public.monthly_tuition as tuition on tuition.id = event.tuition_id
  join tf_seven_tuition_corrections as target on target.student_id = tuition.student_id
  where event.action = 'due_date_corrected_after_enrollment'
    and event.details->>'reason' = 'Solicitação administrativa de 22/10/2026';
  if corrected_count <> 15 then
    raise exception 'Expected 15 tuition due-date audit entries; found %', corrected_count;
  end if;

  select count(*) into mismatch_count
  from public.monthly_tuition as tuition
  join tf_seven_tuition_corrections as target on target.student_id = tuition.student_id
  where tuition.due_date is distinct from private.resolve_student_tuition_due_date(
    tuition.student_id, tuition.reference_month, tuition.due_date
  );
  if mismatch_count <> 0 then
    raise exception 'Due-date verification failed for % tuition records', mismatch_count;
  end if;
end;
$check$;

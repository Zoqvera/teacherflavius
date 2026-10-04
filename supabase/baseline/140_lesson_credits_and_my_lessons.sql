-- Lesson credits and the student "Minhas Aulas" workflow.
-- Credits are granted only after a tuition is settled (payment or exemption).
-- Regular lesson cancellation is allowed until 12 hours before the lesson.

alter table public.student_billing_settings
  add column if not exists classes_per_month smallint;

alter table public.student_billing_settings
  drop constraint if exists student_billing_settings_classes_per_month_check;

alter table public.student_billing_settings
  add constraint student_billing_settings_classes_per_month_check
  check (classes_per_month is null or classes_per_month between 1 and 31);

create table if not exists private.lesson_credits (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  tuition_id uuid not null references public.monthly_tuition(id) on delete cascade,
  reference_month date not null,
  credit_number smallint not null check (credit_number between 1 and 31),
  status text not null check (status in ('scheduled', 'available', 'used')),
  regular_class_number integer,
  regular_class_name text,
  regular_starts_at timestamptz,
  regular_ends_at timestamptz,
  makeup_booking_id uuid references public.makeup_class_bookings(id) on delete set null,
  cancelled_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_credits_reference_month_first_day
    check (reference_month = date_trunc('month', reference_month)::date),
  constraint lesson_credits_regular_schedule_consistency
    check (
      (regular_starts_at is null and regular_ends_at is null)
      or
      (regular_starts_at is not null and regular_ends_at is not null and regular_ends_at > regular_starts_at)
    ),
  unique (tuition_id, credit_number)
);

create index if not exists lesson_credits_student_status_idx
  on private.lesson_credits (student_id, status, revoked_at, reference_month);

create index if not exists lesson_credits_regular_occurrence_idx
  on private.lesson_credits (regular_class_number, regular_starts_at)
  where regular_class_number is not null;

create index if not exists lesson_credits_makeup_booking_idx
  on private.lesson_credits (makeup_booking_id)
  where makeup_booking_id is not null;

revoke all on table private.lesson_credits from public, anon, authenticated;
grant select, insert, update, delete on table private.lesson_credits to service_role;

create or replace function private.touch_lesson_credit_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.touch_lesson_credit_updated_at() from public, anon, authenticated;

drop trigger if exists lesson_credits_set_updated_at on private.lesson_credits;
create trigger lesson_credits_set_updated_at
before update on private.lesson_credits
for each row
execute function private.touch_lesson_credit_updated_at();

create or replace function private.sync_lesson_credits_for_tuition(target_tuition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tuition_row public.monthly_tuition%rowtype;
  contracted_count smallint;
begin
  select tuition.*
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id;

  if not found or tuition_row.student_id is null then
    return;
  end if;

  if tuition_row.payment_date is null and coalesce(tuition_row.is_exempt, false) = false then
    update public.makeup_class_bookings booking
    set
      status = 'cancelled',
      cancelled_at = coalesce(booking.cancelled_at, now())
    where booking.id in (
      select credit.makeup_booking_id
      from private.lesson_credits credit
      where credit.tuition_id = tuition_row.id
        and credit.revoked_at is null
        and credit.makeup_booking_id is not null
    )
      and booking.status = 'confirmed';

    update private.lesson_credits credit
    set revoked_at = coalesce(credit.revoked_at, now())
    where credit.tuition_id = tuition_row.id
      and credit.revoked_at is null;
    return;
  end if;

  select settings.classes_per_month
  into contracted_count
  from public.student_billing_settings settings
  where settings.student_id = tuition_row.student_id;

  if contracted_count is null then
    return;
  end if;

  update public.makeup_class_bookings booking
  set
    status = 'cancelled',
    cancelled_at = coalesce(booking.cancelled_at, now())
  where booking.id in (
    select credit.makeup_booking_id
    from private.lesson_credits credit
    where credit.tuition_id = tuition_row.id
      and credit.credit_number > contracted_count
      and credit.revoked_at is null
      and credit.makeup_booking_id is not null
  )
    and booking.status = 'confirmed';

  update private.lesson_credits credit
  set revoked_at = case
    when credit.credit_number > contracted_count then coalesce(credit.revoked_at, now())
    else null
  end
  where credit.tuition_id = tuition_row.id;

  with candidate_occurrences as (
    select
      row_number() over (
        order by
          ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') asc,
          class.class_number asc
      )::smallint as credit_number,
      class.class_number,
      class.class_name,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((lesson_day::date + class.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    cross join generate_series(
      tuition_row.reference_month::timestamp,
      (tuition_row.reference_month + interval '1 month - 1 day')::timestamp,
      interval '1 day'
    ) as lesson_day
    where membership.user_id = tuition_row.student_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
  ), desired_credits as (
    select
      credit_number,
      occurrence.class_number,
      occurrence.class_name,
      occurrence.starts_at,
      occurrence.ends_at
    from generate_series(1, contracted_count::integer) as series(credit_number)
    left join candidate_occurrences occurrence
      on occurrence.credit_number = series.credit_number
  )
  insert into private.lesson_credits (
    student_id,
    tuition_id,
    reference_month,
    credit_number,
    status,
    regular_class_number,
    regular_class_name,
    regular_starts_at,
    regular_ends_at,
    revoked_at
  )
  select
    tuition_row.student_id,
    tuition_row.id,
    tuition_row.reference_month,
    desired.credit_number::smallint,
    case when desired.starts_at is null then 'available' else 'scheduled' end,
    desired.class_number,
    desired.class_name,
    desired.starts_at,
    desired.ends_at,
    null
  from desired_credits desired
  on conflict (tuition_id, credit_number) do update
  set revoked_at = null;

  with candidate_occurrences as (
    select
      row_number() over (
        order by
          ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') asc,
          class.class_number asc
      )::smallint as credit_number,
      class.class_number,
      class.class_name,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((lesson_day::date + class.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    cross join generate_series(
      tuition_row.reference_month::timestamp,
      (tuition_row.reference_month + interval '1 month - 1 day')::timestamp,
      interval '1 day'
    ) as lesson_day
    where membership.user_id = tuition_row.student_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
  )
  update private.lesson_credits credit
  set
    status = 'scheduled',
    regular_class_number = occurrence.class_number,
    regular_class_name = occurrence.class_name,
    regular_starts_at = occurrence.starts_at,
    regular_ends_at = occurrence.ends_at
  from candidate_occurrences occurrence
  where credit.tuition_id = tuition_row.id
    and credit.credit_number = occurrence.credit_number
    and credit.credit_number <= contracted_count
    and credit.revoked_at is null
    and credit.status = 'available'
    and credit.cancelled_at is null
    and credit.makeup_booking_id is null
    and credit.regular_starts_at is null;
end;
$$;

revoke execute on function private.sync_lesson_credits_for_tuition(uuid) from public, anon, authenticated;
grant execute on function private.sync_lesson_credits_for_tuition(uuid) to service_role;

create or replace function private.sync_lesson_credits_from_tuition_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_lesson_credits_for_tuition(new.id);
  return new;
end;
$$;

revoke execute on function private.sync_lesson_credits_from_tuition_trigger() from public, anon, authenticated;

drop trigger if exists sync_lesson_credits_after_tuition_change on public.monthly_tuition;
create trigger sync_lesson_credits_after_tuition_change
after insert or update of payment_date, is_exempt, student_id, reference_month
on public.monthly_tuition
for each row
execute function private.sync_lesson_credits_from_tuition_trigger();

create or replace function private.release_lesson_credit_from_makeup_booking_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed' and new.status = 'cancelled' then
    update private.lesson_credits credit
    set
      status = 'available',
      used_at = null
    where credit.makeup_booking_id = new.id
      and credit.student_id = new.student_id
      and credit.revoked_at is null
      and credit.status = 'used';
  end if;

  return new;
end;
$$;

revoke execute on function private.release_lesson_credit_from_makeup_booking_trigger() from public, anon, authenticated;

drop trigger if exists release_lesson_credit_after_makeup_cancellation on public.makeup_class_bookings;
create trigger release_lesson_credit_after_makeup_cancellation
after update of status on public.makeup_class_bookings
for each row
execute function private.release_lesson_credit_from_makeup_booking_trigger();

create or replace function public.get_teacher_student_lesson_plans()
returns table (
  student_id uuid,
  classes_per_month smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    settings.classes_per_month
  from public.profiles profile
  left join public.student_billing_settings settings
    on settings.student_id = profile.id
  where coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false
    and not exists (
      select 1
      from public.teacher_admins admin
      where admin.user_id = profile.id
    )
  order by profile.name asc nulls last, profile.email asc nulls last;
end;
$$;

revoke execute on function public.get_teacher_student_lesson_plans() from public, anon;
grant execute on function public.get_teacher_student_lesson_plans() to authenticated, service_role;

create or replace function public.save_student_lesson_plan(
  target_student_id uuid,
  target_classes_per_month integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tuition_record record;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_classes_per_month is null or target_classes_per_month < 1 or target_classes_per_month > 31 then
    raise exception 'A quantidade de aulas por mês deve estar entre 1 e 31.';
  end if;

  update public.student_billing_settings settings
  set
    classes_per_month = target_classes_per_month::smallint,
    updated_at = now(),
    updated_by = auth.uid()
  where settings.student_id = target_student_id;

  if not found then
    raise exception 'Defina primeiro a mensalidade deste aluno.';
  end if;

  for tuition_record in
    select tuition.id
    from public.monthly_tuition tuition
    where tuition.student_id = target_student_id
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_record.id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'student_id', target_student_id,
    'classes_per_month', target_classes_per_month
  );
end;
$$;

revoke execute on function public.save_student_lesson_plan(uuid, integer) from public, anon;
grant execute on function public.save_student_lesson_plan(uuid, integer) to authenticated, service_role;

create or replace function public.get_my_lessons_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  enrolled_classes jsonb := '[]'::jsonb;
  classes_per_month smallint;
  settled boolean := false;
  available_credits integer := 0;
  current_month_credits integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_number', class.class_number,
        'class_name', class.class_name,
        'class_weekday', class.class_weekday,
        'class_start_time', class.class_start_time
      )
      order by class.class_number
    ),
    '[]'::jsonb
  )
  into enrolled_classes
  from public.class_students membership
  join public.teacher_classes class
    on class.class_number = membership.class_number
   and class.is_active = true
  where membership.user_id = caller_id;

  select settings.classes_per_month
  into classes_per_month
  from public.student_billing_settings settings
  where settings.student_id = caller_id;

  select exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and tuition.reference_month = current_month
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  )
  into settled;

  select count(*)::integer
  into available_credits
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.status = 'available';

  select count(*)::integer
  into current_month_credits
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.reference_month = current_month;

  return jsonb_build_object(
    'reference_month', current_month,
    'is_paid', settled,
    'classes_per_month', classes_per_month,
    'available_credits', available_credits,
    'current_month_credits', current_month_credits,
    'classes', enrolled_classes
  );
end;
$$;

revoke execute on function public.get_my_lessons_overview() from public, anon;
grant execute on function public.get_my_lessons_overview() to authenticated, service_role;

create or replace function public.get_my_lesson_credits()
returns table (
  credit_id uuid,
  reference_month date,
  credit_number smallint,
  status text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  meeting_url text,
  original_class_number integer,
  original_class_name text,
  original_starts_at timestamptz,
  cancellation_deadline timestamptz,
  can_cancel boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  return query
  select
    credit.id,
    credit.reference_month,
    credit.credit_number,
    credit.status,
    case when credit.status = 'used' then booking.class_number else credit.regular_class_number end,
    case when credit.status = 'used' then booking.class_name else credit.regular_class_name end,
    case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end,
    case when credit.status = 'used' then slot.ends_at else credit.regular_ends_at end,
    case
      when credit.status = 'used' then booking.meeting_url
      else regular_resource.video_lesson_url
    end,
    credit.regular_class_number,
    credit.regular_class_name,
    credit.regular_starts_at,
    case
      when credit.status = 'used' then slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled' then credit.regular_starts_at - interval '12 hours'
      else null
    end,
    case
      when credit.status = 'used' and booking.status = 'confirmed'
        then now() <= slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled'
        then now() <= credit.regular_starts_at - interval '12 hours'
      else false
    end
  from private.lesson_credits credit
  left join public.makeup_class_bookings booking
    on booking.id = credit.makeup_booking_id
  left join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  left join public.class_resources regular_resource
    on regular_resource.class_number = credit.regular_class_number
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and (
      credit.reference_month = current_month
      or credit.status = 'available'
      or (credit.status = 'used' and slot.starts_at >= current_month::timestamptz)
    )
  order by
    case when credit.status = 'available' then 1 else 0 end,
    coalesce(
      case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end,
      (credit.reference_month + interval '1 month')::timestamptz
    ) asc,
    credit.reference_month asc,
    credit.credit_number asc;
end;
$$;

revoke execute on function public.get_my_lesson_credits() from public, anon;
grant execute on function public.get_my_lesson_credits() to authenticated, service_role;

create or replace function public.cancel_my_regular_lesson(target_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar sua aula.' using errcode = '42501';
  end if;

  select credit.*
  into credit_row
  from private.lesson_credits credit
  where credit.id = target_credit_id
    and credit.student_id = caller_id
    and credit.revoked_at is null
  for update;

  if not found then
    raise exception 'Crédito de aula não encontrado.';
  end if;

  if credit_row.status <> 'scheduled' or credit_row.regular_starts_at is null then
    raise exception 'Somente uma aula regular confirmada pode ser cancelada por esta ação.';
  end if;

  if now() > credit_row.regular_starts_at - interval '12 hours' then
    raise exception 'O prazo para cancelamento terminou 12 horas antes da aula.';
  end if;

  insert into private.student_regular_lesson_cancellations (
    student_id,
    class_number,
    lesson_date,
    cancelled_by
  ) values (
    caller_id,
    credit_row.regular_class_number,
    (credit_row.regular_starts_at at time zone 'America/Sao_Paulo')::date,
    caller_id
  )
  on conflict (student_id, class_number, lesson_date) do nothing;

  update private.lesson_credits credit
  set
    status = 'available',
    cancelled_at = now()
  where credit.id = credit_row.id;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', 'available'
  );
end;
$$;

revoke execute on function public.cancel_my_regular_lesson(uuid) from public, anon;
grant execute on function public.cancel_my_regular_lesson(uuid) to authenticated, service_role;

create or replace function public.get_my_replacement_options()
returns table (
  class_number integer,
  class_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  available_spots integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar as reposições.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.lesson_credits credit
    where credit.student_id = caller_id
      and credit.revoked_at is null
      and credit.status = 'available'
  ) then
    return;
  end if;

  return query
  with class_counts as (
    select
      class.class_number,
      count(membership.id) filter (
        where membership.invite_id is not null
           or (
             membership.user_id is not null
             and coalesce(profile.enrolled, false) = true
             and coalesce(profile.archived, false) = false
           )
      )::integer as regular_students
    from public.teacher_classes class
    left join public.class_students membership
      on membership.class_number = class.class_number
    left join public.profiles profile
      on profile.id = membership.user_id
    where class.is_active = true
      and class.class_type = 'quintet'
    group by class.class_number
  ), occurrences as (
    select
      class.class_number,
      class.class_name,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((lesson_day::date + class.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at,
      private.get_class_operational_capacity(class.class_number)::integer as capacity_limit,
      counts.regular_students
    from public.teacher_classes class
    join class_counts counts
      on counts.class_number = class.class_number
    join public.class_resources resource
      on resource.class_number = class.class_number
     and nullif(trim(resource.video_lesson_url), '') ~* '^https?://'
    cross join generate_series(
      (now() at time zone 'America/Sao_Paulo')::date::timestamp,
      ((now() at time zone 'America/Sao_Paulo')::date + 29)::timestamp,
      interval '1 day'
    ) as lesson_day
    where class.is_active = true
      and class.class_type = 'quintet'
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
      and not exists (
        select 1
        from public.class_students own_membership
        where own_membership.user_id = caller_id
          and own_membership.class_number = class.class_number
      )
  ), capacity_snapshot as (
    select
      occurrence.*,
      (
        select count(*)::integer
        from private.student_regular_lesson_cancellations cancellation
        where cancellation.class_number = occurrence.class_number
          and cancellation.lesson_date = (occurrence.starts_at at time zone 'America/Sao_Paulo')::date
          and exists (
            select 1
            from public.class_students current_membership
            where current_membership.user_id = cancellation.student_id
              and current_membership.class_number = occurrence.class_number
          )
      ) as cancelled_regular_students,
      (
        select count(*)::integer
        from public.makeup_class_bookings booking
        join public.makeup_class_slots slot
          on slot.id = booking.slot_id
        where booking.status = 'confirmed'
          and slot.is_active = true
          and booking.class_number = occurrence.class_number
          and slot.starts_at = occurrence.starts_at
      ) as replacement_students
    from occurrences occurrence
    where occurrence.starts_at > now()
      and occurrence.capacity_limit is not null
      and not exists (
        select 1
        from private.lesson_credits own_credit
        left join public.makeup_class_bookings own_booking
          on own_booking.id = own_credit.makeup_booking_id
        left join public.makeup_class_slots own_slot
          on own_slot.id = own_booking.slot_id
        where own_credit.student_id = caller_id
          and own_credit.revoked_at is null
          and (
            (own_credit.status = 'scheduled' and own_credit.regular_starts_at = occurrence.starts_at)
            or
            (own_credit.status = 'used' and own_booking.status = 'confirmed' and own_slot.starts_at = occurrence.starts_at)
          )
      )
      and not exists (
        select 1
        from public.makeup_class_bookings caller_booking
        join public.makeup_class_slots caller_slot
          on caller_slot.id = caller_booking.slot_id
        where caller_booking.student_id = caller_id
          and caller_booking.status = 'confirmed'
          and caller_slot.is_active = true
          and caller_slot.starts_at = occurrence.starts_at
      )
  )
  select
    snapshot.class_number,
    snapshot.class_name,
    snapshot.starts_at,
    snapshot.ends_at,
    greatest(
      0,
      snapshot.capacity_limit
      - (snapshot.regular_students - snapshot.cancelled_regular_students + snapshot.replacement_students)
    )::integer as available_spots
  from capacity_snapshot snapshot
  where snapshot.capacity_limit
        - (snapshot.regular_students - snapshot.cancelled_regular_students + snapshot.replacement_students) > 0
  order by snapshot.starts_at asc, snapshot.class_name asc;
end;
$$;

revoke execute on function public.get_my_replacement_options() from public, anon;
grant execute on function public.get_my_replacement_options() to authenticated, service_role;

create or replace function public.book_my_lesson_replacement(
  target_credit_id uuid,
  target_class_number integer,
  target_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
  class_row public.teacher_classes%rowtype;
  class_resource_url text;
  local_start timestamp without time zone;
  capacity_limit integer;
  regular_students integer := 0;
  cancelled_regular_students integer := 0;
  replacement_students integer := 0;
  target_slot_id uuid;
  target_booking_id uuid;
  student_name text;
  student_email text;
begin
  if caller_id is null then
    raise exception 'Faça login para marcar uma reposição.' using errcode = '42501';
  end if;

  select credit.*
  into credit_row
  from private.lesson_credits credit
  join public.monthly_tuition tuition
    on tuition.id = credit.tuition_id
   and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  where credit.id = target_credit_id
    and credit.student_id = caller_id
    and credit.revoked_at is null
  for update of credit;

  if not found then
    raise exception 'Crédito disponível não encontrado.';
  end if;

  if credit_row.status <> 'available' then
    raise exception 'Este crédito não está disponível para reposição.';
  end if;

  select class.*
  into class_row
  from public.teacher_classes class
  where class.class_number = target_class_number
    and class.is_active = true
    and class.class_type = 'quintet'
  for update;

  if not found then
    raise exception 'A turma selecionada não está disponível para reposição.';
  end if;

  if exists (
    select 1
    from public.class_students membership
    where membership.user_id = caller_id
      and membership.class_number = target_class_number
  ) then
    raise exception 'Escolha outra turma para a reposição.';
  end if;

  if target_starts_at <= now() then
    raise exception 'Escolha uma aula futura.';
  end if;

  local_start := target_starts_at at time zone 'America/Sao_Paulo';
  if class_row.class_weekday is null
     or class_row.class_start_time is null
     or extract(isodow from local_start)::integer <> class_row.class_weekday
     or local_start::time <> class_row.class_start_time
  then
    raise exception 'O horário selecionado não corresponde à agenda atual da turma.';
  end if;

  select nullif(trim(resource.video_lesson_url), '')
  into class_resource_url
  from public.class_resources resource
  where resource.class_number = target_class_number;

  if coalesce(class_resource_url, '') !~* '^https?://' then
    raise exception 'A turma selecionada ainda não possui um link de aula válido.';
  end if;

  if exists (
    select 1
    from private.lesson_credits own_credit
    left join public.makeup_class_bookings own_booking
      on own_booking.id = own_credit.makeup_booking_id
    left join public.makeup_class_slots own_slot
      on own_slot.id = own_booking.slot_id
    where own_credit.student_id = caller_id
      and own_credit.revoked_at is null
      and own_credit.id <> credit_row.id
      and (
        (own_credit.status = 'scheduled' and own_credit.regular_starts_at = target_starts_at)
        or
        (own_credit.status = 'used' and own_booking.status = 'confirmed' and own_slot.starts_at = target_starts_at)
      )
  ) then
    raise exception 'Você já possui outra aula confirmada neste mesmo horário.';
  end if;

  if exists (
    select 1
    from public.makeup_class_bookings caller_booking
    join public.makeup_class_slots caller_slot
      on caller_slot.id = caller_booking.slot_id
    where caller_booking.student_id = caller_id
      and caller_booking.status = 'confirmed'
      and caller_slot.is_active = true
      and caller_slot.starts_at = target_starts_at
  ) then
    raise exception 'Você já possui uma reposição confirmada neste horário.';
  end if;

  capacity_limit := private.get_class_operational_capacity(target_class_number);
  if capacity_limit is null then
    raise exception 'Não foi possível determinar a capacidade desta turma.';
  end if;

  select count(membership.id) filter (
    where membership.invite_id is not null
       or (
         membership.user_id is not null
         and coalesce(profile.enrolled, false) = true
         and coalesce(profile.archived, false) = false
       )
  )::integer
  into regular_students
  from public.class_students membership
  left join public.profiles profile
    on profile.id = membership.user_id
  where membership.class_number = target_class_number;

  select count(*)::integer
  into cancelled_regular_students
  from private.student_regular_lesson_cancellations cancellation
  where cancellation.class_number = target_class_number
    and cancellation.lesson_date = (target_starts_at at time zone 'America/Sao_Paulo')::date
    and exists (
      select 1
      from public.class_students current_membership
      where current_membership.user_id = cancellation.student_id
        and current_membership.class_number = target_class_number
    );

  select count(*)::integer
  into replacement_students
  from public.makeup_class_bookings booking
  join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  where booking.status = 'confirmed'
    and slot.is_active = true
    and booking.class_number = target_class_number
    and slot.starts_at = target_starts_at;

  if regular_students - cancelled_regular_students + replacement_students >= capacity_limit then
    raise exception 'A última vaga deste horário acabou de ser reservada. Escolha outra turma.';
  end if;

  select slot.id
  into target_slot_id
  from public.makeup_class_slots slot
  where slot.class_number = target_class_number
    and slot.starts_at = target_starts_at
    and slot.is_active = true
  for update;

  if target_slot_id is null then
    begin
      insert into public.makeup_class_slots (
        class_number,
        class_name,
        meeting_url,
        starts_at,
        ends_at,
        capacity,
        notes,
        is_active,
        created_by,
        is_auto_generated
      ) values (
        target_class_number,
        class_row.class_name,
        class_resource_url,
        target_starts_at,
        target_starts_at + interval '1 hour',
        capacity_limit,
        'Reposição por crédito de aula',
        true,
        null,
        false
      )
      returning id into target_slot_id;
    exception when unique_violation then
      select slot.id
      into target_slot_id
      from public.makeup_class_slots slot
      where slot.class_number = target_class_number
        and slot.starts_at = target_starts_at
        and slot.is_active = true
      for update;
    end;
  end if;

  select
    coalesce(nullif(trim(profile.name), ''), nullif(trim(user_account.raw_user_meta_data ->> 'name'), ''), user_account.email, 'Aluno'),
    coalesce(nullif(trim(profile.email), ''), user_account.email, '')
  into student_name, student_email
  from auth.users user_account
  left join public.profiles profile
    on profile.id = user_account.id
  where user_account.id = caller_id;

  if coalesce(student_email, '') = '' then
    raise exception 'Seu cadastro não possui e-mail. Atualize o perfil antes de marcar a reposição.';
  end if;

  insert into public.makeup_class_bookings (
    slot_id,
    student_id,
    class_number,
    class_name,
    student_name,
    student_email,
    meeting_url
  ) values (
    target_slot_id,
    caller_id,
    target_class_number,
    class_row.class_name,
    student_name,
    student_email,
    class_resource_url
  )
  returning id into target_booking_id;

  update private.lesson_credits credit
  set
    status = 'used',
    makeup_booking_id = target_booking_id,
    used_at = now()
  where credit.id = credit_row.id;

  insert into public.makeup_class_email_notifications (booking_id, notification_type)
  values (target_booking_id, 'booking_confirmation')
  on conflict (booking_id, notification_type) do nothing;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'booking_id', target_booking_id,
    'class_number', target_class_number,
    'starts_at', target_starts_at
  );
end;
$$;

revoke execute on function public.book_my_lesson_replacement(uuid, integer, timestamptz) from public, anon;
grant execute on function public.book_my_lesson_replacement(uuid, integer, timestamptz) to authenticated, service_role;

create or replace function public.cancel_my_lesson_replacement(target_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
  booking_starts_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar sua reposição.' using errcode = '42501';
  end if;

  select credit.*
  into credit_row
  from private.lesson_credits credit
  where credit.id = target_credit_id
    and credit.student_id = caller_id
    and credit.revoked_at is null
  for update;

  if not found then
    raise exception 'Crédito de aula não encontrado.';
  end if;

  if credit_row.status <> 'used' or credit_row.makeup_booking_id is null then
    raise exception 'Este crédito não possui uma reposição confirmada.';
  end if;

  select slot.starts_at
  into booking_starts_at
  from public.makeup_class_bookings booking
  join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  where booking.id = credit_row.makeup_booking_id
    and booking.student_id = caller_id
    and booking.status = 'confirmed'
  for update of booking;

  if not found then
    raise exception 'A reserva de reposição não está mais confirmada.';
  end if;

  if now() > booking_starts_at - interval '12 hours' then
    raise exception 'O prazo para cancelamento terminou 12 horas antes da aula.';
  end if;

  update public.makeup_class_bookings booking
  set
    status = 'cancelled',
    cancelled_at = now()
  where booking.id = credit_row.makeup_booking_id
    and booking.student_id = caller_id
    and booking.status = 'confirmed';

  insert into public.makeup_class_email_notifications (booking_id, notification_type)
  values (credit_row.makeup_booking_id, 'cancellation')
  on conflict (booking_id, notification_type) do nothing;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', 'available'
  );
end;
$$;

revoke execute on function public.cancel_my_lesson_replacement(uuid) from public, anon;
grant execute on function public.cancel_my_lesson_replacement(uuid) to authenticated, service_role;

create or replace function public.cancel_my_unpaid_class(target_class_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  removed_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar sua matrícula nesta turma.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and tuition.reference_month = current_month
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  ) then
    raise exception 'Sua mensalidade deste mês já está paga. Cancele uma aula confirmada em vez de sair da turma.';
  end if;

  delete from public.class_students membership
  where membership.user_id = caller_id
    and membership.class_number = target_class_number;
  get diagnostics removed_count = row_count;

  if removed_count = 0 then
    raise exception 'Você não está matriculado nesta turma.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_number', target_class_number,
    'removed', true
  );
end;
$$;

revoke execute on function public.cancel_my_unpaid_class(integer) from public, anon;
grant execute on function public.cancel_my_unpaid_class(integer) to authenticated, service_role;

-- Stop new bookings through the legacy creditless flow. Existing reservations can
-- still be viewed and cancelled. New replacements must consume a lesson credit.
revoke execute on function public.book_makeup_class(uuid) from public, anon, authenticated;
grant execute on function public.book_makeup_class(uuid) to service_role;

-- Backfill credits for already-settled tuition only when the teacher has already
-- defined a monthly lesson quantity. Existing students are never assigned a guessed value.
do $$
declare
  tuition_record record;
begin
  for tuition_record in
    select tuition.id
    from public.monthly_tuition tuition
    join public.student_billing_settings settings
      on settings.student_id = tuition.student_id
    where settings.classes_per_month is not null
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_record.id);
  end loop;
end;
$$;

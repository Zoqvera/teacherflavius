create table if not exists private.trial_lesson_appointments (
  id uuid primary key default gen_random_uuid(),
  visitor_name text not null,
  english_level text not null,
  whatsapp text not null,
  whatsapp_digits text generated always as (regexp_replace(whatsapp, '[^0-9]', '', 'g')) stored,
  lesson_mode text not null,
  class_number integer references public.teacher_classes(class_number) on update cascade on delete set null,
  class_name_snapshot text,
  starts_at timestamptz not null,
  status text not null default 'scheduled',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  enrolled_after_trial_at timestamptz,
  enrolled_after_trial_by uuid references auth.users(id) on delete set null,
  constraint trial_lesson_visitor_name_check
    check (char_length(btrim(visitor_name)) between 2 and 120),
  constraint trial_lesson_level_check
    check (english_level in ('A1','A2','B1','B2','C1','C2','Não definido')),
  constraint trial_lesson_whatsapp_check
    check (char_length(whatsapp_digits) between 8 and 15),
  constraint trial_lesson_mode_check
    check (lesson_mode in ('class','individual')),
  constraint trial_lesson_status_check
    check (status in ('scheduled','completed','cancelled','no_show')),
  constraint trial_lesson_class_mode_check
    check (
      (lesson_mode = 'class' and class_name_snapshot is not null)
      or
      (lesson_mode = 'individual' and class_number is null and class_name_snapshot is null)
    ),
  constraint trial_lesson_enrollment_completed_check
    check (enrolled_after_trial_at is null or status = 'completed')
);

alter table private.trial_lesson_appointments enable row level security;

revoke all on table private.trial_lesson_appointments from public, anon, authenticated;
grant select, insert, update, delete on table private.trial_lesson_appointments to service_role;

create index if not exists trial_lesson_appointments_class_number_idx
  on private.trial_lesson_appointments (class_number)
  where class_number is not null;
create index if not exists trial_lesson_appointments_created_by_idx
  on private.trial_lesson_appointments (created_by);
create index if not exists trial_lesson_appointments_starts_at_idx
  on private.trial_lesson_appointments (starts_at desc);
create index if not exists trial_lesson_appointments_status_starts_at_idx
  on private.trial_lesson_appointments (status, starts_at desc);
create unique index if not exists trial_lesson_appointments_unique_active_person_time_idx
  on private.trial_lesson_appointments (whatsapp_digits, starts_at)
  where status <> 'cancelled';

create table if not exists private.student_regular_lesson_cancellations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  class_number integer not null references public.teacher_classes(class_number) on delete restrict,
  lesson_date date not null,
  cancelled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint student_regular_lesson_cancellations_unique
    unique (student_id, class_number, lesson_date)
);

alter table private.student_regular_lesson_cancellations enable row level security;

revoke all on table private.student_regular_lesson_cancellations from public, anon, authenticated;
grant select, insert, update, delete on table private.student_regular_lesson_cancellations to service_role;

create index if not exists student_regular_lesson_cancellations_date_idx
  on private.student_regular_lesson_cancellations (lesson_date, class_number);

drop function if exists public.get_teacher_students_of_day();

create function public.get_teacher_students_of_day()
returns table (
  entry_id uuid,
  lesson_kind text,
  student_id uuid,
  student_name text,
  whatsapp text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  lesson_to_present text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_date date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  return query
  with lesson_progress as (
    select
      clr.user_id,
      max(substring(clr.lesson_code from 2)::integer)
        filter (where clr.lesson_code ~ '^L[0-9]+$') as max_lesson_number
    from public.class_lesson_records clr
    where clr.user_id is not null
      and clr.class_date < target_date
    group by clr.user_id
  ),
  regular_lessons as (
    select
      cs.id as entry_id,
      'regular'::text as lesson_kind,
      p.id as student_id,
      coalesce(nullif(btrim(p.name), ''), nullif(btrim(p.email), ''), 'Aluno')::text as student_name,
      nullif(btrim(p.whatsapp), '')::text as whatsapp,
      tc.class_number,
      tc.class_name::text as class_name,
      ((target_date + tc.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      case
        when progress.max_lesson_number is null then 'L1'
        when progress.max_lesson_number >= 74 then 'Concluído'
        else 'L' || (progress.max_lesson_number + 1)::text
      end::text as lesson_to_present
    from public.teacher_classes tc
    join public.class_students cs
      on cs.class_number = tc.class_number
     and cs.user_id is not null
    join public.profiles p
      on p.id = cs.user_id
    left join lesson_progress progress
      on progress.user_id = p.id
    where tc.is_active = true
      and tc.class_weekday = extract(isodow from target_date)::smallint
      and tc.class_start_time is not null
      and coalesce(p.enrolled, false) = true
      and coalesce(p.archived, false) = false
      and not exists (
        select 1
        from private.student_regular_lesson_cancellations cancellation
        where cancellation.student_id = p.id
          and cancellation.class_number = tc.class_number
          and cancellation.lesson_date = target_date
      )
  ),
  makeup_lessons as (
    select
      booking.id as entry_id,
      'makeup'::text as lesson_kind,
      booking.student_id,
      coalesce(
        nullif(btrim(profile.name), ''),
        nullif(btrim(booking.student_name), ''),
        nullif(btrim(booking.student_email), ''),
        'Aluno'
      )::text as student_name,
      nullif(btrim(profile.whatsapp), '')::text as whatsapp,
      booking.class_number,
      booking.class_name::text as class_name,
      slot.starts_at,
      case
        when progress.max_lesson_number is null then 'L1'
        when progress.max_lesson_number >= 74 then 'Concluído'
        else 'L' || (progress.max_lesson_number + 1)::text
      end::text as lesson_to_present
    from public.makeup_class_bookings booking
    join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    join public.profiles profile
      on profile.id = booking.student_id
    left join lesson_progress progress
      on progress.user_id = booking.student_id
    where booking.status = 'confirmed'
      and slot.is_active = true
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and (slot.starts_at at time zone 'America/Sao_Paulo')::date = target_date
  ),
  trial_lessons as (
    select
      appointment.id as entry_id,
      'trial'::text as lesson_kind,
      null::uuid as student_id,
      appointment.visitor_name::text as student_name,
      nullif(btrim(appointment.whatsapp), '')::text as whatsapp,
      appointment.class_number,
      coalesce(
        nullif(btrim(appointment.class_name_snapshot), ''),
        case when appointment.lesson_mode = 'individual'
          then 'Aula experimental individual'
          else 'Aula experimental'
        end
      )::text as class_name,
      appointment.starts_at,
      null::text as lesson_to_present
    from private.trial_lesson_appointments appointment
    where appointment.status = 'scheduled'
      and (appointment.starts_at at time zone 'America/Sao_Paulo')::date = target_date
  )
  select daily.entry_id,
         daily.lesson_kind,
         daily.student_id,
         daily.student_name,
         daily.whatsapp,
         daily.class_number,
         daily.class_name,
         daily.starts_at,
         daily.lesson_to_present
  from (
    select * from regular_lessons
    union all
    select * from makeup_lessons
    union all
    select * from trial_lessons
  ) daily
  order by daily.starts_at asc, daily.student_name asc, daily.lesson_kind asc;
end;
$function$;

revoke all on function public.get_teacher_students_of_day() from public, anon, authenticated;
grant execute on function public.get_teacher_students_of_day() to authenticated;

create or replace function public.set_teacher_day_student_whatsapp(
  target_lesson_kind text,
  target_entry_id uuid,
  target_whatsapp text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_kind text := lower(btrim(coalesce(target_lesson_kind, '')));
  normalized_digits text := regexp_replace(coalesce(target_whatsapp, ''), '[^0-9]', '', 'g');
  target_date date := (now() at time zone 'America/Sao_Paulo')::date;
  resolved_student_id uuid;
  trial_whatsapp text;
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  if char_length(normalized_digits) not between 10 and 15 then
    raise exception 'Informe um número de WhatsApp válido.' using errcode = '22023';
  end if;

  if normalized_kind = 'regular' then
    select cs.user_id
      into resolved_student_id
    from public.class_students cs
    join public.teacher_classes tc
      on tc.class_number = cs.class_number
     and tc.is_active = true
    join public.profiles p
      on p.id = cs.user_id
    where cs.id = target_entry_id
      and cs.user_id is not null
      and tc.class_weekday = extract(isodow from target_date)::smallint
      and tc.class_start_time is not null
      and coalesce(p.enrolled, false) = true
      and coalesce(p.archived, false) = false;

    if not found then
      raise exception 'Aula regular de hoje não encontrada.' using errcode = 'P0002';
    end if;

    update public.profiles
    set whatsapp = normalized_digits
    where id = resolved_student_id;
  elsif normalized_kind = 'makeup' then
    select booking.student_id
      into resolved_student_id
    from public.makeup_class_bookings booking
    join public.makeup_class_slots slot on slot.id = booking.slot_id
    where booking.id = target_entry_id
      and booking.status = 'confirmed'
      and slot.is_active = true
      and (slot.starts_at at time zone 'America/Sao_Paulo')::date = target_date;

    if not found then
      raise exception 'Reposição de hoje não encontrada.' using errcode = 'P0002';
    end if;

    update public.profiles
    set whatsapp = normalized_digits
    where id = resolved_student_id;
  elsif normalized_kind = 'trial' then
    trial_whatsapp := case
      when char_length(normalized_digits) in (10, 11) then '+55' || normalized_digits
      else normalized_digits
    end;

    update private.trial_lesson_appointments appointment
    set whatsapp = trial_whatsapp,
        updated_at = now()
    where appointment.id = target_entry_id
      and appointment.status = 'scheduled'
      and (appointment.starts_at at time zone 'America/Sao_Paulo')::date = target_date;

    if not found then
      raise exception 'Aula experimental de hoje não encontrada.' using errcode = 'P0002';
    end if;
  else
    raise exception 'Tipo de aula inválido.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'lesson_kind', normalized_kind,
    'whatsapp_digits',
      case
        when normalized_kind = 'trial' and char_length(normalized_digits) in (10, 11)
          then '55' || normalized_digits
        else normalized_digits
      end
  );
end;
$function$;

revoke all on function public.set_teacher_day_student_whatsapp(text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.set_teacher_day_student_whatsapp(text,uuid,text)
  to authenticated;

create or replace function public.cancel_teacher_day_lesson(
  target_lesson_kind text,
  target_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_kind text := lower(btrim(coalesce(target_lesson_kind, '')));
  target_date date := (now() at time zone 'America/Sao_Paulo')::date;
  resolved_student_id uuid;
  resolved_class_number integer;
  cancellation_inserted integer := 0;
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  if normalized_kind = 'regular' then
    select cs.user_id, cs.class_number
      into resolved_student_id, resolved_class_number
    from public.class_students cs
    join public.teacher_classes tc
      on tc.class_number = cs.class_number
     and tc.is_active = true
    join public.profiles p
      on p.id = cs.user_id
    where cs.id = target_entry_id
      and cs.user_id is not null
      and tc.class_weekday = extract(isodow from target_date)::smallint
      and tc.class_start_time is not null
      and coalesce(p.enrolled, false) = true
      and coalesce(p.archived, false) = false;

    if not found then
      raise exception 'Aula regular de hoje não encontrada.' using errcode = 'P0002';
    end if;

    insert into private.student_regular_lesson_cancellations (
      student_id,
      class_number,
      lesson_date,
      cancelled_by
    )
    values (
      resolved_student_id,
      resolved_class_number,
      target_date,
      auth.uid()
    )
    on conflict (student_id, class_number, lesson_date) do nothing;

    get diagnostics cancellation_inserted = row_count;

    if cancellation_inserted > 0 then
      insert into public.student_frequency (
        user_id,
        class_date,
        attendance_status,
        class_notes
      )
      values (
        resolved_student_id,
        target_date,
        'Faltou',
        '[Turma ' || resolved_class_number || '] Não compareceu na aula.'
      );
    end if;
  elsif normalized_kind = 'makeup' then
    update public.makeup_class_bookings booking
    set status = 'cancelled',
        cancelled_at = now()
    where booking.id = target_entry_id
      and booking.status = 'confirmed'
      and exists (
        select 1
        from public.makeup_class_slots slot
        where slot.id = booking.slot_id
          and (slot.starts_at at time zone 'America/Sao_Paulo')::date = target_date
      )
    returning booking.student_id, booking.class_number
      into resolved_student_id, resolved_class_number;

    if not found then
      raise exception 'Reposição confirmada de hoje não encontrada.' using errcode = 'P0002';
    end if;

    insert into public.student_frequency (
      user_id,
      class_date,
      attendance_status,
      class_notes
    )
    values (
      resolved_student_id,
      target_date,
      'Faltou',
      '[Turma ' || resolved_class_number || '] Não compareceu na aula.'
    );

    insert into public.makeup_class_email_notifications (
      booking_id,
      notification_type
    )
    values (
      target_entry_id,
      'cancellation'
    )
    on conflict (booking_id, notification_type) do nothing;
  elsif normalized_kind = 'trial' then
    update private.trial_lesson_appointments appointment
    set status = 'no_show',
        enrolled_after_trial_at = null,
        enrolled_after_trial_by = null,
        updated_at = now()
    where appointment.id = target_entry_id
      and appointment.status = 'scheduled'
      and (appointment.starts_at at time zone 'America/Sao_Paulo')::date = target_date;

    if not found then
      raise exception 'Aula experimental de hoje não encontrada.' using errcode = 'P0002';
    end if;
  else
    raise exception 'Tipo de aula inválido.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'lesson_kind', normalized_kind,
    'entry_id', target_entry_id,
    'attendance_recorded', true
  );
end;
$function$;

revoke all on function public.cancel_teacher_day_lesson(text,uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_teacher_day_lesson(text,uuid)
  to authenticated;

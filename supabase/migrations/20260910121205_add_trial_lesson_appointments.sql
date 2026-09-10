create table private.trial_lesson_appointments (
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
  constraint trial_lesson_visitor_name_check check (char_length(btrim(visitor_name)) between 2 and 120),
  constraint trial_lesson_level_check check (english_level in ('A1','A2','B1','B2','C1','C2','Não definido')),
  constraint trial_lesson_whatsapp_check check (char_length(whatsapp_digits) between 8 and 15),
  constraint trial_lesson_mode_check check (lesson_mode in ('class','individual')),
  constraint trial_lesson_status_check check (status in ('scheduled','completed','cancelled','no_show')),
  constraint trial_lesson_class_mode_check check (
    (lesson_mode = 'class' and class_number is not null and class_name_snapshot is not null)
    or (lesson_mode = 'individual' and class_number is null and class_name_snapshot is null)
  )
);

alter table private.trial_lesson_appointments enable row level security;

revoke all on table private.trial_lesson_appointments from public, anon, authenticated;
grant select, insert, update, delete on table private.trial_lesson_appointments to service_role;

create index trial_lesson_appointments_starts_at_idx
  on private.trial_lesson_appointments (starts_at desc);
create index trial_lesson_appointments_status_starts_at_idx
  on private.trial_lesson_appointments (status, starts_at desc);
create unique index trial_lesson_appointments_unique_active_person_time_idx
  on private.trial_lesson_appointments (whatsapp_digits, starts_at)
  where status <> 'cancelled';

create or replace function public.get_teacher_trial_lesson_classes()
returns table (
  class_number integer,
  class_name text,
  class_type text,
  class_weekday smallint,
  class_start_time time without time zone
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  return query
  select
    tc.class_number,
    tc.class_name,
    tc.class_type,
    tc.class_weekday,
    tc.class_start_time
  from public.teacher_classes tc
  where tc.is_active = true
    and tc.class_weekday is not null
    and tc.class_start_time is not null
  order by tc.class_weekday, tc.class_start_time, tc.class_number;
end;
$$;

create or replace function public.get_teacher_trial_lessons()
returns table (
  id uuid,
  visitor_name text,
  english_level text,
  whatsapp text,
  whatsapp_digits text,
  lesson_mode text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  return query
  select
    appointment.id,
    appointment.visitor_name,
    appointment.english_level,
    appointment.whatsapp,
    appointment.whatsapp_digits,
    appointment.lesson_mode,
    appointment.class_number,
    appointment.class_name_snapshot,
    appointment.starts_at,
    appointment.status,
    appointment.created_at,
    appointment.updated_at
  from private.trial_lesson_appointments appointment
  order by appointment.starts_at desc
  limit 200;
end;
$$;

create or replace function public.create_teacher_trial_lesson(
  target_name text,
  target_english_level text,
  target_whatsapp text,
  target_mode text,
  target_date date,
  target_time time without time zone,
  target_class_number integer
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_level text := btrim(coalesce(target_english_level, ''));
  normalized_whatsapp text := btrim(coalesce(target_whatsapp, ''));
  normalized_mode text := btrim(coalesce(target_mode, ''));
  selected_class_name text;
  selected_weekday smallint;
  selected_start_time time without time zone;
  scheduled_time time without time zone;
  appointment_starts_at timestamptz;
  appointment_id uuid;
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  if normalized_name = '' then
    raise exception 'Informe o nome da pessoa.' using errcode = '22023';
  end if;
  if normalized_level not in ('A1','A2','B1','B2','C1','C2','Não definido') then
    raise exception 'Selecione um nível de inglês válido.' using errcode = '22023';
  end if;
  if char_length(regexp_replace(normalized_whatsapp, '[^0-9]', '', 'g')) not between 8 and 15 then
    raise exception 'Informe um WhatsApp válido.' using errcode = '22023';
  end if;
  if normalized_mode not in ('class','individual') then
    raise exception 'Selecione um formato de aula experimental válido.' using errcode = '22023';
  end if;
  if target_date is null then
    raise exception 'Informe a data da aula experimental.' using errcode = '22023';
  end if;
  if target_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A aula experimental não pode ser agendada no passado.' using errcode = '22023';
  end if;

  if normalized_mode = 'class' then
    select tc.class_name, tc.class_weekday, tc.class_start_time
      into selected_class_name, selected_weekday, selected_start_time
    from public.teacher_classes tc
    where tc.class_number = target_class_number
      and tc.is_active = true
      and tc.class_weekday is not null
      and tc.class_start_time is not null;

    if not found then
      raise exception 'Selecione uma turma ativa com dia e horário definidos.' using errcode = '22023';
    end if;
    if extract(isodow from target_date)::smallint <> selected_weekday then
      raise exception 'A data escolhida não corresponde ao dia semanal da turma.' using errcode = '22023';
    end if;
    scheduled_time := selected_start_time;
  else
    if target_class_number is not null then
      raise exception 'Aula individual não deve estar vinculada a uma turma.' using errcode = '22023';
    end if;
    if target_time is null then
      raise exception 'Informe o horário da aula experimental individual.' using errcode = '22023';
    end if;
    scheduled_time := target_time;
  end if;

  appointment_starts_at := (target_date + scheduled_time) at time zone 'America/Sao_Paulo';
  if appointment_starts_at <= now() then
    raise exception 'A aula experimental deve ser agendada para um horário futuro.' using errcode = '22023';
  end if;

  insert into private.trial_lesson_appointments (
    visitor_name,
    english_level,
    whatsapp,
    lesson_mode,
    class_number,
    class_name_snapshot,
    starts_at,
    created_by
  ) values (
    normalized_name,
    normalized_level,
    normalized_whatsapp,
    normalized_mode,
    case when normalized_mode = 'class' then target_class_number else null end,
    case when normalized_mode = 'class' then selected_class_name else null end,
    appointment_starts_at,
    auth.uid()
  )
  returning id into appointment_id;

  return appointment_id;
exception
  when unique_violation then
    raise exception 'Já existe uma aula experimental ativa para este WhatsApp nesse horário.' using errcode = '23505';
end;
$$;

create or replace function public.update_teacher_trial_lesson_status(
  target_appointment_id uuid,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  normalized_status text := btrim(coalesce(target_status, ''));
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;
  if normalized_status not in ('scheduled','completed','cancelled','no_show') then
    raise exception 'Status de aula experimental inválido.' using errcode = '22023';
  end if;

  update private.trial_lesson_appointments
  set status = normalized_status,
      updated_at = now()
  where id = target_appointment_id;

  if not found then
    raise exception 'Aula experimental não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_teacher_trial_lesson_classes() from public, anon, authenticated;
revoke all on function public.get_teacher_trial_lessons() from public, anon, authenticated;
revoke all on function public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer) from public, anon, authenticated;
revoke all on function public.update_teacher_trial_lesson_status(uuid,text) from public, anon, authenticated;

grant execute on function public.get_teacher_trial_lesson_classes() to authenticated;
grant execute on function public.get_teacher_trial_lessons() to authenticated;
grant execute on function public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer) to authenticated;
grant execute on function public.update_teacher_trial_lesson_status(uuid,text) to authenticated;

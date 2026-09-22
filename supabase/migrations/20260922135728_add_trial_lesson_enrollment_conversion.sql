alter table private.trial_lesson_appointments
  add column if not exists enrolled_after_trial_at timestamptz,
  add column if not exists enrolled_after_trial_by uuid references auth.users(id) on delete set null;

alter table private.trial_lesson_appointments
  drop constraint if exists trial_lesson_enrollment_completed_check;

alter table private.trial_lesson_appointments
  add constraint trial_lesson_enrollment_completed_check check (
    enrolled_after_trial_at is null or status = 'completed'
  );

drop function if exists public.get_teacher_trial_lessons();

create function public.get_teacher_trial_lessons()
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
  enrolled_after_trial boolean,
  enrolled_after_trial_at timestamptz,
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
    appointment.enrolled_after_trial_at is not null,
    appointment.enrolled_after_trial_at,
    appointment.created_at,
    appointment.updated_at
  from private.trial_lesson_appointments appointment
  order by appointment.starts_at desc
  limit 200;
end;
$$;

create or replace function public.set_teacher_trial_lesson_enrollment(
  target_appointment_id uuid,
  target_enrolled boolean
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  appointment_status text;
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  if target_enrolled is null then
    raise exception 'Informe se a pessoa se matriculou.' using errcode = '22023';
  end if;

  select appointment.status
    into appointment_status
  from private.trial_lesson_appointments appointment
  where appointment.id = target_appointment_id
  for update;

  if not found then
    raise exception 'Aula experimental não encontrada.' using errcode = 'P0002';
  end if;

  if target_enrolled and appointment_status <> 'completed' then
    raise exception 'A informação de matrícula só pode ser registrada em aulas experimentais concluídas.' using errcode = '22023';
  end if;

  update private.trial_lesson_appointments
  set enrolled_after_trial_at = case
        when target_enrolled then coalesce(enrolled_after_trial_at, now())
        else null
      end,
      enrolled_after_trial_by = case
        when target_enrolled then auth.uid()
        else null
      end,
      updated_at = now()
  where id = target_appointment_id;
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
      enrolled_after_trial_at = case when normalized_status = 'completed' then enrolled_after_trial_at else null end,
      enrolled_after_trial_by = case when normalized_status = 'completed' then enrolled_after_trial_by else null end,
      updated_at = now()
  where id = target_appointment_id;

  if not found then
    raise exception 'Aula experimental não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_teacher_trial_lessons() from public, anon, authenticated;
revoke all on function public.set_teacher_trial_lesson_enrollment(uuid,boolean) from public, anon, authenticated;
revoke all on function public.update_teacher_trial_lesson_status(uuid,text) from public, anon, authenticated;

grant execute on function public.get_teacher_trial_lessons() to authenticated;
grant execute on function public.set_teacher_trial_lesson_enrollment(uuid,boolean) to authenticated;
grant execute on function public.update_teacher_trial_lesson_status(uuid,text) to authenticated;

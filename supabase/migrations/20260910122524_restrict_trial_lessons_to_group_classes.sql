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
    and tc.class_type in ('quartet', 'eight_students')
    and tc.class_weekday is not null
    and tc.class_start_time is not null
  order by tc.class_weekday, tc.class_start_time, tc.class_number;
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
      and tc.class_type in ('quartet', 'eight_students')
      and tc.class_weekday is not null
      and tc.class_start_time is not null;

    if not found then
      raise exception 'Selecione uma turma coletiva ativa com dia e horário definidos.' using errcode = '22023';
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

revoke all on function public.get_teacher_trial_lesson_classes() from public, anon, authenticated;
revoke all on function public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer) from public, anon, authenticated;
grant execute on function public.get_teacher_trial_lesson_classes() to authenticated;
grant execute on function public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer) to authenticated;

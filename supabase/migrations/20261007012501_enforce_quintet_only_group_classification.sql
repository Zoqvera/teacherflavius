-- Permanent class model: INDIVIDUAL or QUINTETO only.
-- Historical migrations remain audit history, but active data, constraints,
-- administrative writes and runtime functions cannot recreate legacy class types.

set lock_timeout = '5s';
set statement_timeout = '60s';

update public.profiles
set class_type = 'QUINTETO'
where class_type in ('QUARTETO', '8 ALUNOS');

update public.teacher_classes
set class_type = 'quintet',
    capacity_override = 8,
    updated_at = now()
where class_type in ('quartet', 'eight_students');

alter table public.profiles
  drop constraint if exists profiles_class_type_check;

alter table public.profiles
  add constraint profiles_class_type_check
  check (class_type is null or class_type in ('INDIVIDUAL', 'QUINTETO'));

alter table public.teacher_classes
  drop constraint if exists teacher_classes_class_type_check;

alter table public.teacher_classes
  add constraint teacher_classes_class_type_check
  check (class_type is null or class_type in ('individual', 'quintet'));

drop function if exists public.get_public_quartet_vacancies();

CREATE OR REPLACE FUNCTION private.get_class_operational_capacity(target_class_number integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when tc.class_type = 'quintet' then 8
    else coalesce(
      tc.capacity_override::integer,
      case
        when tc.class_type = 'individual' then 1
                        else null
      end
    )
  end
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION private.run_operational_data_quality_check(target_notify boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  started_at_value timestamptz := now();
  completed_at_value timestamptz;
  health_status text := 'healthy';
  warning_count_value integer := 0;
  critical_count_value integer := 0;
  issue_count_value integer := 0;
  run_id uuid;
  issue_record record;
  orphan_class_assignments integer := 0;
  invalid_class_student_refs integer := 0;
  class_capacity_exceeded integer := 0;
  student_class_type_mismatch integer := 0;
  typed_student_without_active_class integer := 0;
  duplicate_active_cpf integer := 0;
  archive_state_mismatch integer := 0;
  active_class_schedule_missing integer := 0;
  makeup_capacity_exceeded integer := 0;
  makeup_booking_class_mismatch integer := 0;
  makeup_status_timestamp_mismatch integer := 0;
  future_auto_slot_invalid_class integer := 0;
  lesson_orphan_class integer := 0;
  frequency_invalid_subject_ref integer := 0;
  tuition_subject_mismatch integer := 0;
  payment_attempt_subject_mismatch integer := 0;
  archived_class_memberships integer := 0;
  active_billing_archived_students integer := 0;
  multiple_lesson_sessions integer := 0;
  metrics_value jsonb;
  issues_value jsonb;
begin
  create temporary table if not exists pg_temp.operational_data_quality_issues (
    issue_code text,
    severity text,
    details jsonb
  ) on commit drop;
  truncate pg_temp.operational_data_quality_issues;

  select count(*)::integer into orphan_class_assignments
  from public.class_students cs
  left join public.teacher_classes tc on tc.class_number = cs.class_number
  where tc.class_number is null;

  select count(*)::integer into invalid_class_student_refs
  from public.class_students cs
  where (cs.user_id is null and cs.invite_id is null)
     or (cs.user_id is not null and cs.invite_id is not null);

  select count(*)::integer into class_capacity_exceeded
  from (
    select tc.class_number
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
    group by tc.class_number
    having count(cs.id) filter (
      where cs.invite_id is not null
         or (cs.user_id is not null and coalesce(p.enrolled, false) = true and coalesce(p.archived, false) = false)
    ) > private.get_class_operational_capacity(tc.class_number)
  ) over_capacity;

  select count(*)::integer into student_class_type_mismatch
  from public.class_students cs
  join public.profiles p on p.id = cs.user_id
  join public.teacher_classes tc on tc.class_number = cs.class_number
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and tc.is_active = true
    and p.class_type is not null
    and (case p.class_type when 'INDIVIDUAL' then 'individual' when 'QUINTETO' then 'quintet' else null end) is distinct from tc.class_type;

  select count(*)::integer into typed_student_without_active_class
  from public.profiles p
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
    and p.class_type is not null
    and not exists (
      select 1 from public.class_students cs
      join public.teacher_classes tc on tc.class_number = cs.class_number
      where cs.user_id = p.id and tc.is_active = true
    );

  select count(*)::integer into duplicate_active_cpf
  from (
    select regexp_replace(p.cpf, '\D', '', 'g') as normalized_cpf
    from public.profiles p
    where coalesce(p.enrolled, false) = true
      and coalesce(p.archived, false) = false
      and nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '') is not null
    group by regexp_replace(p.cpf, '\D', '', 'g')
    having count(*) > 1
  ) duplicated;

  select count(*)::integer into archive_state_mismatch
  from public.profiles p
  where (p.archived = true and p.archived_at is null)
     or (p.archived = false and p.archived_at is not null);

  select count(*)::integer into active_class_schedule_missing
  from public.teacher_classes tc
  where tc.is_active = true
    and upper(btrim(tc.class_name)) <> 'INDETERMINADA'
    and (tc.class_type is null or tc.class_weekday is null or tc.class_start_time is null);

  select count(*)::integer into makeup_capacity_exceeded
  from (
    select s.id
    from public.makeup_class_slots s
    left join public.makeup_class_bookings b on b.slot_id = s.id and b.status = 'confirmed'
    group by s.id, s.capacity
    having count(b.id) > s.capacity
  ) over_capacity;

  select count(*)::integer into makeup_booking_class_mismatch
  from public.makeup_class_bookings b
  join public.makeup_class_slots s on s.id = b.slot_id
  where s.class_number is not null and b.class_number <> s.class_number;

  select count(*)::integer into makeup_status_timestamp_mismatch
  from public.makeup_class_bookings b
  where (b.status = 'cancelled' and b.cancelled_at is null)
     or (b.status = 'confirmed' and b.cancelled_at is not null);

  select count(*)::integer into future_auto_slot_invalid_class
  from public.makeup_class_slots s
  left join public.teacher_classes tc on tc.class_number = s.class_number
  where s.is_auto_generated = true
    and s.is_active = true
    and s.starts_at > now()
    and (tc.class_number is null or tc.is_active = false);

  select count(*)::integer into lesson_orphan_class
  from public.class_lesson_records clr
  left join public.teacher_classes tc on tc.class_number = clr.class_number
  where tc.class_number is null;

  select count(*)::integer into frequency_invalid_subject_ref
  from public.student_frequency sf
  where (sf.user_id is null and sf.invite_id is null)
     or (sf.user_id is not null and sf.invite_id is not null);

  select count(*)::integer into tuition_subject_mismatch
  from public.monthly_tuition mt
  where mt.student_id is not null and mt.subject_ref <> mt.student_id;

  select count(*)::integer into payment_attempt_subject_mismatch
  from public.tuition_payment_attempts attempt
  join public.monthly_tuition mt on mt.id = attempt.tuition_id
  where attempt.subject_ref <> mt.subject_ref or attempt.student_id is distinct from mt.student_id;

  select count(*)::integer into archived_class_memberships
  from public.class_students cs join public.profiles p on p.id = cs.user_id
  where p.archived = true;

  select count(*)::integer into active_billing_archived_students
  from public.student_billing_settings billing join public.profiles p on p.id = billing.student_id
  where billing.active = true and p.archived = true;

  select count(*)::integer into multiple_lesson_sessions
  from (
    select clr.class_number, clr.class_date, coalesce(clr.user_id::text, 'invite:' || clr.invite_id::text)
    from public.class_lesson_records clr
    group by clr.class_number, clr.class_date, coalesce(clr.user_id::text, 'invite:' || clr.invite_id::text)
    having count(*) > 1
  ) sessions;

  if orphan_class_assignments > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_orphan_class_assignments','critical',jsonb_build_object('count',orphan_class_assignments)); end if;
  if invalid_class_student_refs > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_invalid_class_student_refs','critical',jsonb_build_object('count',invalid_class_student_refs)); end if;
  if class_capacity_exceeded > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_class_capacity_exceeded','critical',jsonb_build_object('count',class_capacity_exceeded)); end if;
  if student_class_type_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_student_class_type_mismatch','warning',jsonb_build_object('count',student_class_type_mismatch)); end if;  -- Classified students without a class are valid while awaiting placement.  if duplicate_active_cpf > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_duplicate_active_cpf','critical',jsonb_build_object('count',duplicate_active_cpf)); end if;
  if archive_state_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_archive_state_mismatch','warning',jsonb_build_object('count',archive_state_mismatch)); end if;
  if active_class_schedule_missing > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_active_class_schedule_missing','warning',jsonb_build_object('count',active_class_schedule_missing)); end if;
  if makeup_capacity_exceeded > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_capacity_exceeded','critical',jsonb_build_object('count',makeup_capacity_exceeded)); end if;
  if makeup_booking_class_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_booking_class_mismatch','warning',jsonb_build_object('count',makeup_booking_class_mismatch)); end if;
  if makeup_status_timestamp_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_makeup_status_timestamp_mismatch','warning',jsonb_build_object('count',makeup_status_timestamp_mismatch)); end if;
  if future_auto_slot_invalid_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_future_auto_slot_invalid_class','warning',jsonb_build_object('count',future_auto_slot_invalid_class)); end if;
  if lesson_orphan_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_lesson_orphan_class','warning',jsonb_build_object('count',lesson_orphan_class)); end if;
  if frequency_invalid_subject_ref > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_frequency_invalid_subject_ref','critical',jsonb_build_object('count',frequency_invalid_subject_ref)); end if;
  if tuition_subject_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_tuition_subject_mismatch','critical',jsonb_build_object('count',tuition_subject_mismatch)); end if;
  if payment_attempt_subject_mismatch > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_payment_attempt_subject_mismatch','critical',jsonb_build_object('count',payment_attempt_subject_mismatch)); end if;

  select count(*) filter (where severity='warning')::integer,
         count(*) filter (where severity='critical')::integer,
         coalesce(jsonb_agg(jsonb_build_object('code',issue_code,'severity',severity,'details',details) order by issue_code),'[]'::jsonb)
    into warning_count_value, critical_count_value, issues_value
  from pg_temp.operational_data_quality_issues;

  warning_count_value := coalesce(warning_count_value,0);
  critical_count_value := coalesce(critical_count_value,0);
  issue_count_value := warning_count_value + critical_count_value;
  if critical_count_value > 0 then health_status := 'critical'; elsif warning_count_value > 0 then health_status := 'degraded'; end if;

  metrics_value := jsonb_build_object(
    'orphan_class_assignments',orphan_class_assignments,
    'invalid_class_student_refs',invalid_class_student_refs,
    'class_capacity_exceeded',class_capacity_exceeded,
    'student_class_type_mismatch',student_class_type_mismatch,
    'typed_student_without_active_class_info',typed_student_without_active_class,
    'duplicate_active_cpf',duplicate_active_cpf,
    'archive_state_mismatch',archive_state_mismatch,
    'active_class_schedule_missing',active_class_schedule_missing,
    'makeup_capacity_exceeded',makeup_capacity_exceeded,
    'makeup_booking_class_mismatch',makeup_booking_class_mismatch,
    'makeup_status_timestamp_mismatch',makeup_status_timestamp_mismatch,
    'future_auto_slot_invalid_class',future_auto_slot_invalid_class,
    'lesson_orphan_class',lesson_orphan_class,
    'frequency_invalid_subject_ref',frequency_invalid_subject_ref,
    'tuition_subject_mismatch',tuition_subject_mismatch,
    'payment_attempt_subject_mismatch',payment_attempt_subject_mismatch,
    'archived_class_memberships_info',archived_class_memberships,
    'active_billing_archived_students_info',active_billing_archived_students,
    'multiple_lesson_sessions_info',multiple_lesson_sessions
  );

  completed_at_value := now();
  insert into private.operational_data_quality_runs(status,issue_count,critical_count,warning_count,metrics,issues,started_at,completed_at)
  values (health_status,issue_count_value,critical_count_value,warning_count_value,metrics_value,issues_value,started_at_value,completed_at_value)
  returning id into run_id;

  if target_notify then
    for issue_record in select issue_code,severity,details from pg_temp.operational_data_quality_issues loop
      perform private.enqueue_system_health_alert(
        issue_record.issue_code,
        issue_record.severity,
        'data-quality:' || issue_record.issue_code || ':' || pg_catalog.md5(issue_record.details::text),
        issue_record.details || jsonb_build_object('data_quality_run_id',run_id,'data_quality_status',health_status)
      );
    end loop;
  end if;

  delete from private.operational_data_quality_runs where completed_at < now() - interval '90 days';

  return jsonb_build_object('id',run_id,'status',health_status,'issue_count',issue_count_value,'critical_count',critical_count_value,'warning_count',warning_count_value,'metrics',metrics_value,'issues',issues_value,'completed_at',completed_at_value);
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_teacher_class_student_by_ref__mfa_inner(target_class_number integer, target_student_ref_id text, target_student_ref_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  inserted_id uuid;
  target_user_id uuid;
  target_invite_id uuid;
  student_type text;
  student_type_internal text;
  class_type_value text;
  assignment_count integer;
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso negado: usuário não cadastrado como professor.';
  end if;

  perform public.assert_teacher_class_exists(target_class_number);

  select tc.class_type into class_type_value
  from public.teacher_classes tc
  where tc.class_number = target_class_number
    and tc.is_active = true;

  if class_type_value is null then
    raise exception 'Defina a etiqueta da turma antes de matricular alunos.';
  end if;

  if target_student_ref_type = 'user' then
    target_user_id := target_student_ref_id::uuid;

    if not exists (
      select 1
      from auth.users u
      where u.id = target_user_id
        and not exists (
          select 1
          from public.teacher_admins ta
          where lower(ta.email) = lower(u.email)
        )
    ) then
      raise exception 'Aluno não encontrado.';
    end if;

    select p.class_type into student_type
    from public.profiles p
    where p.id = target_user_id;
  elsif target_student_ref_type = 'invite' then
    target_invite_id := target_student_ref_id::uuid;

    if not exists (
      select 1
      from public.student_enrollment_invites sei
      where sei.id = target_invite_id
        and sei.status in ('pending', 'completed')
    ) then
      raise exception 'Pré-matrícula não encontrada.';
    end if;

    select p.class_type into student_type
    from public.student_enrollment_invites sei
    join public.profiles p on p.id = sei.user_id
    where sei.id = target_invite_id;
  else
    raise exception 'Tipo de aluno inválido.';
  end if;

  if student_type is null then
    raise exception 'Classifique o tipo de turma do aluno antes de matriculá-lo.';
  end if;

  student_type_internal := case upper(trim(student_type))
    when 'INDIVIDUAL' then 'individual'
        when 'QUINTETO' then 'quintet'
        else null
  end;

  if student_type_internal is null then
    raise exception 'Tipo de turma do aluno inválido: %.', student_type;
  end if;

  if student_type_internal <> class_type_value then
    raise exception 'Tipo incompatível: aluno % e turma %.',
      student_type,
      case class_type_value
        when 'individual' then 'INDIVIDUAL'
        when 'quintet' then 'QUINTETO'
        else class_type_value
      end;
  end if;

  if target_student_ref_type = 'user' then
    insert into public.class_students (class_number, user_id, invite_id)
    values (target_class_number, target_user_id, null)
    on conflict (class_number, user_id) do update
    set user_id = excluded.user_id,
        invite_id = null
    returning id into inserted_id;

    select count(*)::integer into assignment_count
    from public.class_students
    where user_id = target_user_id;
  else
    insert into public.class_students (class_number, user_id, invite_id)
    values (target_class_number, null, target_invite_id)
    on conflict (class_number, invite_id) where invite_id is not null do update
    set invite_id = excluded.invite_id,
        user_id = null
    returning id into inserted_id;

    select count(*)::integer into assignment_count
    from public.class_students
    where invite_id = target_invite_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', inserted_id,
    'class_number', target_class_number,
    'class_type', class_type_value,
    'assignment_count', assignment_count,
    'assignment_limit', 2
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_teacher_class_with_type__mfa_inner(target_class_name text, target_class_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_number integer;
  next_order integer;
  final_name text;
  normalized_type text;
  inserted_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  normalized_type := lower(trim(coalesce(target_class_type, '')));
  if normalized_type not in ('quintet','individual') then
    raise exception 'Tipo de turma inválido. Use quintet ou individual.';
  end if;

  select coalesce(max(class_number), 0) + 1 into next_number from public.teacher_classes;
  select coalesce(max(display_order), 0) + 1 into next_order from public.teacher_classes where is_active = true;
  final_name := coalesce(nullif(trim(target_class_name), ''), 'Turma ' || next_number);

  insert into public.teacher_classes (
    class_number,
    class_name,
    class_type,
    capacity_override,
    display_order,
    is_active
  )
  values (
    next_number,
    final_name,
    normalized_type,
    case when normalized_type = 'quintet' then 8 else null end,
    next_order,
    true
  )
  returning id into inserted_id;

  return jsonb_build_object(
    'ok', true,
    'id', inserted_id,
    'class_number', next_number,
    'class_name', final_name,
    'class_type', normalized_type
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_teacher_trial_lesson(target_name text, target_english_level text, target_whatsapp text, target_mode text, target_date date, target_time time without time zone, target_class_number integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_level text := btrim(coalesce(target_english_level, ''));
  normalized_whatsapp text := btrim(coalesce(target_whatsapp, ''));
  normalized_whatsapp_digits text := regexp_replace(btrim(coalesce(target_whatsapp, '')), '[^0-9]', '', 'g');
  normalized_mode text := btrim(coalesce(target_mode, ''));
  selected_class_name text;
  selected_weekday smallint;
  selected_start_time time without time zone;
  scheduled_time time without time zone;
  appointment_starts_at timestamptz;
  appointment_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if normalized_name = '' then
    raise exception 'Informe o nome da pessoa.' using errcode = '22023';
  end if;
  if normalized_level not in ('A1','A2','B1','B2','C1','C2','Não definido') then
    raise exception 'Selecione um nível de inglês válido.' using errcode = '22023';
  end if;
  if char_length(normalized_whatsapp_digits) not between 8 and 15 then
    raise exception 'Informe um WhatsApp válido.' using errcode = '22023';
  end if;
  if char_length(normalized_whatsapp_digits) in (10, 11) then
    normalized_whatsapp := '+55' || normalized_whatsapp_digits;
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
      and tc.class_type = 'quintet'
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
$function$;

CREATE OR REPLACE FUNCTION public.get_available_group_classes_for_students()
 RETURNS TABLE(class_number integer, class_name text, class_weekday smallint, class_start_time time without time zone, occupied_spots integer, available_spots integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  caller_class_type text;
  target_db_type text;
begin
  if caller_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select p.class_type into caller_class_type
  from public.profiles p
  where p.id = caller_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if caller_class_type is null then
    raise exception 'Seu tipo de turma ainda não foi definido pelo professor.' using errcode = '42501';
  end if;

  target_db_type := case caller_class_type
    when 'INDIVIDUAL' then 'individual'
    when 'QUINTETO' then 'quintet'
    else null
  end;

  if target_db_type is null then
    raise exception 'Tipo de turma inválido no perfil do aluno.';
  end if;

  return query
  with class_counts as (
    select
      tc.class_number,
      tc.class_name,
      tc.class_weekday,
      tc.class_start_time,
      private.get_class_operational_capacity(tc.class_number)::integer as capacity_limit,
      count(cs.id) filter (
        where cs.invite_id is not null
           or (
             cs.user_id is not null
             and coalesce(p.enrolled, false) = true
             and coalesce(p.archived, false) = false
           )
      )::integer as occupied_spots
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
      and tc.class_type = target_db_type
      and not exists (
        select 1 from public.class_students mine
        where mine.user_id = caller_id
          and mine.class_number = tc.class_number
      )
    group by tc.class_number, tc.class_name, tc.class_weekday, tc.class_start_time
  )
  select
    cc.class_number,
    cc.class_name,
    cc.class_weekday,
    cc.class_start_time,
    cc.occupied_spots,
    greatest(0, cc.capacity_limit - cc.occupied_spots)::integer
  from class_counts cc
  where cc.capacity_limit is not null
    and cc.occupied_spots < cc.capacity_limit
  order by (cc.capacity_limit - cc.occupied_spots) desc, cc.class_name asc, cc.class_number asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_group_classes_with_available_spots__mfa_inner()
 RETURNS TABLE(class_number integer, class_name text, class_weekday smallint, class_start_time time without time zone, occupied_spots integer, available_spots integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  return query
  with class_counts as (
    select
      tc.class_number,
      tc.class_name,
      tc.class_weekday,
      tc.class_start_time,
      private.get_class_operational_capacity(tc.class_number)::integer as capacity_limit,
      count(cs.id) filter (
        where cs.invite_id is not null
           or (
             cs.user_id is not null
             and coalesce(p.enrolled, false) = true
             and coalesce(p.archived, false) = false
           )
      )::integer as occupied_spots
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
      and tc.class_type = 'quintet'
    group by tc.class_number, tc.class_name, tc.class_weekday, tc.class_start_time
  )
  select
    cc.class_number,
    cc.class_name,
    cc.class_weekday,
    cc.class_start_time,
    cc.occupied_spots,
    greatest(0, cc.capacity_limit - cc.occupied_spots)::integer
  from class_counts cc
  where cc.capacity_limit is not null
    and cc.occupied_spots < cc.capacity_limit
  order by (cc.capacity_limit - cc.occupied_spots) desc, cc.class_name asc, cc.class_number asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_teacher_trial_lesson_classes()
 RETURNS TABLE(class_number integer, class_name text, class_type text, class_weekday smallint, class_start_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
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
    and tc.class_type = 'quintet'
    and tc.class_weekday is not null
    and tc.class_start_time is not null
  order by tc.class_weekday, tc.class_start_time, tc.class_number;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_teacher_class_type__mfa_inner(target_class_number integer, target_class_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  normalized_type text;
  updated_name text;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  normalized_type := lower(trim(coalesce(target_class_type, '')));
  if normalized_type not in ('quintet','individual') then
    raise exception 'Tipo de turma inválido. Use quintet ou individual.';
  end if;

  update public.teacher_classes
     set class_type = normalized_type,
         capacity_override = case
           when normalized_type = 'quintet' then 8
           when class_type = 'quintet' then null
           else capacity_override
         end,
         updated_at = now()
   where class_number = target_class_number
     and is_active = true
  returning class_name into updated_name;

  if not found then
    raise exception 'Turma não encontrada.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_number', target_class_number,
    'class_name', updated_name,
    'class_type', normalized_type
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.switch_my_group_class(target_class_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  old_class_number integer;
  current_class_count integer;
  occupied_count integer;
  caller_class_type text;
  target_db_type text;
  capacity integer;
begin
  if caller_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select p.class_type into caller_class_type
  from public.profiles p
  where p.id = caller_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if caller_class_type is null then
    raise exception 'Seu tipo de turma ainda não foi definido pelo professor.'
      using errcode = '42501';
  end if;

  target_db_type := case caller_class_type
    when 'INDIVIDUAL' then 'individual'
        when 'QUINTETO' then 'quintet'
        else null
  end;

  if target_db_type is null then
    raise exception 'Tipo de turma inválido no perfil do aluno.';
  end if;

  select count(*)::integer, min(cs.class_number)
  into current_class_count, old_class_number
  from public.class_students cs
  where cs.user_id = caller_id;

  if current_class_count > 1 then
    raise exception 'Você está vinculado a duas turmas. A troca deve ser feita pelo professor para preservar os dois vínculos.'
      using errcode = 'P0001';
  end if;

  if old_class_number = target_class_number then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'old_class_number', old_class_number,
      'new_class_number', target_class_number
    );
  end if;

  perform 1
  from public.teacher_classes tc
  where tc.class_number = target_class_number
    and tc.is_active = true
    and tc.class_type = target_db_type
  for update;

  if not found then
    raise exception 'Esta turma não é compatível com o seu tipo de turma.';
  end if;

  capacity := private.get_class_operational_capacity(target_class_number);
  if capacity is null then
    raise exception 'A capacidade desta turma não está configurada.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73007, target_class_number);

  select count(*)::integer into occupied_count
  from public.class_students cs
  left join public.profiles p on p.id = cs.user_id
  where cs.class_number = target_class_number
    and (
      cs.invite_id is not null
      or (
        cs.user_id is not null
        and coalesce(p.enrolled, false) = true
        and coalesce(p.archived, false) = false
      )
    );

  if occupied_count >= capacity then
    raise exception 'Esta turma não possui mais vagas.';
  end if;

  if old_class_number is not null then
    delete from public.class_students
    where user_id = caller_id
      and class_number = old_class_number;
  end if;

  insert into public.class_students (class_number, user_id, invite_id)
  values (target_class_number, caller_id, null);

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'old_class_number', old_class_number,
    'new_class_number', target_class_number,
    'available_spots_after_change', capacity - occupied_count - 1
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_teacher_trial_lesson(target_appointment_id uuid, target_name text, target_english_level text, target_whatsapp text, target_mode text, target_date date, target_time time without time zone, target_class_number integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_level text := btrim(coalesce(target_english_level, ''));
  normalized_whatsapp text := btrim(coalesce(target_whatsapp, ''));
  normalized_whatsapp_digits text := regexp_replace(btrim(coalesce(target_whatsapp, '')), '[^0-9]', '', 'g');
  normalized_mode text := btrim(coalesce(target_mode, ''));
  appointment_status text;
  selected_class_name text;
  selected_weekday smallint;
  selected_start_time time without time zone;
  scheduled_time time without time zone;
  appointment_starts_at timestamptz;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  select appointment.status
    into appointment_status
  from private.trial_lesson_appointments appointment
  where appointment.id = target_appointment_id
  for update;

  if not found then
    raise exception 'Aula experimental não encontrada.' using errcode = 'P0002';
  end if;

  if appointment_status <> 'scheduled' then
    raise exception 'Somente aulas experimentais agendadas podem ser editadas.' using errcode = '22023';
  end if;

  if normalized_name = '' then
    raise exception 'Informe o nome da pessoa.' using errcode = '22023';
  end if;
  if normalized_level not in ('A1','A2','B1','B2','C1','C2','Não definido') then
    raise exception 'Selecione um nível de inglês válido.' using errcode = '22023';
  end if;
  if char_length(normalized_whatsapp_digits) not between 8 and 15 then
    raise exception 'Informe um WhatsApp válido.' using errcode = '22023';
  end if;
  if char_length(normalized_whatsapp_digits) in (10, 11) then
    normalized_whatsapp := '+55' || normalized_whatsapp_digits;
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
      and tc.class_type = 'quintet'
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
    raise exception 'A aula experimental deve permanecer em um horário futuro.' using errcode = '22023';
  end if;

  update private.trial_lesson_appointments
  set visitor_name = normalized_name,
      english_level = normalized_level,
      whatsapp = normalized_whatsapp,
      lesson_mode = normalized_mode,
      class_number = case when normalized_mode = 'class' then target_class_number else null end,
      class_name_snapshot = case when normalized_mode = 'class' then selected_class_name else null end,
      starts_at = appointment_starts_at,
      updated_at = now()
  where id = target_appointment_id;
exception
  when unique_violation then
    raise exception 'Já existe uma aula experimental ativa para este WhatsApp nesse horário.' using errcode = '23505';
end;
$function$;

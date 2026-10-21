-- Do not undo a cancellation with a revoked contractual credit; require financial reconciliation.
CREATE OR REPLACE FUNCTION public.restore_teacher_cancelled_regular_lesson(target_entry_id uuid, target_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  student_id uuid;
  class_id integer;
  scheduled_start timestamptz;
  cancellation_id uuid;
  matching_credits integer;
  matching_credit private.lesson_credits%rowtype;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;
  if target_entry_id is null or target_date is null then
    raise exception 'Aluno e data são obrigatórios.' using errcode = '22023';
  end if;

  select membership.user_id, class.class_number,
         ((target_date + class.class_start_time) at time zone 'America/Sao_Paulo')
  into student_id, class_id, scheduled_start
  from public.class_students membership
  join public.teacher_classes class on class.class_number = membership.class_number
  join public.profiles profile on profile.id = membership.user_id
  where membership.id = target_entry_id
    and membership.user_id is not null
    and class.is_active = true
    and class.class_start_time is not null
    and class.class_weekday = extract(isodow from target_date)::smallint
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;
  if not found then
    raise exception 'Aluno não está matriculado nesta turma e data.' using errcode = 'P0002';
  end if;

  select cancellation.id into cancellation_id
  from private.student_regular_lesson_cancellations cancellation
  where cancellation.student_id = student_id
    and cancellation.class_number = class_id
    and cancellation.lesson_date = target_date
  for update;
  if not found then
    raise exception 'Esta aula não está cancelada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from private.academic_class_session_finalizations finalization
    where finalization.class_number = class_id and finalization.starts_at = scheduled_start
  ) then
    raise exception 'Esta aula já foi finalizada. Não é possível descancelar após a finalização.' using errcode = '22023';
  end if;

  select count(*) into matching_credits
  from private.lesson_credits credit
  where credit.student_id = student_id
    and credit.credit_origin = 'contract'
    and credit.regular_class_number = class_id
    and credit.regular_starts_at = scheduled_start
    and credit.revoked_at is null;
  if matching_credits > 1 then
    raise exception 'Há créditos conflitantes para esta aula. Regularize antes de descancelar.' using errcode = '23514';
  end if;

  -- A revoked contractual credit is not silently recreated by restoring a lesson.
  if exists (
    select 1 from private.lesson_credits credit
    where credit.student_id = student_id
      and credit.credit_origin = 'contract'
      and credit.regular_class_number = class_id
      and credit.regular_starts_at = scheduled_start
      and credit.revoked_at is not null
  ) then
    raise exception 'O crédito contratual foi revogado. Regularize o contrato antes de descancelar.' using errcode = '22023';
  end if;

  if matching_credits = 1 then
    select credit.* into matching_credit
    from private.lesson_credits credit
    where credit.student_id = student_id
      and credit.credit_origin = 'contract'
      and credit.regular_class_number = class_id
      and credit.regular_starts_at = scheduled_start
      and credit.revoked_at is null
    for update;

    if matching_credit.makeup_booking_id is not null
       or matching_credit.status = 'used'
       or matching_credit.status not in ('available', 'forfeited', 'scheduled') then
      raise exception 'O crédito já está reservado ou foi utilizado. Regularize a reposição antes de descancelar.' using errcode = '22023';
    end if;
    if matching_credit.status in ('available', 'forfeited')
       and matching_credit.cancelled_at is null then
      raise exception 'O crédito não corresponde ao cancelamento desta aula.' using errcode = '22023';
    end if;
    if matching_credit.status in ('available', 'forfeited') then
      update private.lesson_credits credit
      set status = 'scheduled', cancelled_at = null
      where credit.id = matching_credit.id;
    end if;
  end if;

  delete from private.student_regular_lesson_cancellations cancellation
  where cancellation.id = cancellation_id;

  -- Preserve attendance history except automatic absence for teacher day-cancellation.
  delete from public.student_frequency frequency
  where frequency.user_id = student_id
    and frequency.class_date = target_date
    and frequency.attendance_status = 'Faltou'
    and frequency.class_notes = '[Turma ' || class_id || '] Não compareceu na aula.';

  insert into private.student_regular_lesson_restorations (
    student_id, class_number, lesson_date, cancellation_id, credit_id, restored_by
  ) values (
    student_id, class_id, target_date, cancellation_id, matching_credit.id, auth.uid()
  );

  return jsonb_build_object(
    'ok', true, 'student_id', student_id, 'class_number', class_id,
    'lesson_date', target_date, 'credit_reinstated', matching_credit.id is not null
  );
end;
$function$;

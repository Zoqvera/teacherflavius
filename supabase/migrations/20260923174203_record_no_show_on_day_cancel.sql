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

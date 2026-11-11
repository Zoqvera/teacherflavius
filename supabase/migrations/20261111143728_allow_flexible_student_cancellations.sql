-- Permite cancelar reservas FLEXIVEL antes do início, com devolução do crédito
-- somente até 12 horas antes da aula. Mantém a validade do ciclo original.

create or replace function private.guard_flexible_booking_change()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  lesson_start timestamptz;
begin
  if old.booking_kind is distinct from 'flexible'
     or auth.uid() is null
     or coalesce(public.is_teacher_admin(), false) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'Reservas FLEXIVEL não podem ser excluídas pelo aluno.' using errcode = '42501';
  end if;

  select slot.starts_at into lesson_start
  from public.makeup_class_slots slot
  where slot.id = old.slot_id;

  if old.student_id = auth.uid()
     and old.status = 'confirmed'
     and new.status = 'cancelled'
     and new.cancelled_at = now()
     and lesson_start > now()
     and (to_jsonb(new) - 'status' - 'cancelled_at')
         = (to_jsonb(old) - 'status' - 'cancelled_at') then
    return new;
  end if;

  raise exception 'Somente o cancelamento da sua reserva FLEXIVEL antes da aula é permitido.'
    using errcode = '42501';
end;
$function$;
revoke all on function private.guard_flexible_booking_change() from public, anon, authenticated;

-- A devolução mantém o crédito original: não cria créditos duplicados e
-- conserva a cobertura financeira. Cancelamentos tardios perdem o crédito.
-- Cancelamentos administrativos preservam a devolução já existente.
create or replace function private.release_lesson_credit_from_makeup_booking_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  lesson_start timestamptz;
  student_flexible_cancellation boolean;
  should_return_credit boolean;
begin
  if old.status <> 'confirmed' or new.status <> 'cancelled' then
    return new;
  end if;

  student_flexible_cancellation := new.booking_kind = 'flexible'
    and auth.uid() = new.student_id
    and not coalesce(public.is_teacher_admin(), false);

  should_return_credit := true;
  if student_flexible_cancellation then
    select slot.starts_at into lesson_start
    from public.makeup_class_slots slot
    where slot.id = new.slot_id;

    should_return_credit := private.lesson_cancellation_grants_credit(
      lesson_start, now()
    );
  end if;

  update private.lesson_credits credit
  set status = case when should_return_credit then 'available' else 'forfeited' end,
      used_at = case when should_return_credit then null else credit.used_at end,
      makeup_booking_id = case
        when should_return_credit and new.booking_kind = 'flexible'
          then null
        else credit.makeup_booking_id
      end,
      cancelled_at = case
        when should_return_credit then credit.cancelled_at
        else new.cancelled_at
      end
  where credit.makeup_booking_id = new.id
    and credit.student_id = new.student_id
    and credit.revoked_at is null
    and credit.status = 'used';

  return new;
end;
$function$;
revoke all on function private.release_lesson_credit_from_makeup_booking_trigger()
  from public, anon, authenticated;

-- A página recebe o prazo e a elegibilidade calculados no banco.
create or replace function public.get_my_flexible_lessons()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  caller uuid := auth.uid();
  result jsonb;
begin
  if caller is null then
    raise exception 'Faça login.' using errcode = '42501';
  end if;
  if not private.is_flexible_student(caller) then
    return null;
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.id = caller and profile.enrolled and not profile.archived
  ) then
    raise exception 'Matrícula inativa.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'booking_mode', 'FLEXIVEL',
    'options', coalesce((
      select jsonb_agg(
        to_jsonb(option_row) || jsonb_build_object(
          'can_book',
          private.flexible_credit_for_date(
            caller, (option_row.starts_at at time zone 'America/Sao_Paulo')::date
          ) is not null
          and not exists (
            select 1 from public.makeup_class_bookings booking
            where booking.student_id = caller
              and booking.booking_kind = 'flexible'
              and booking.status = 'confirmed'
              and booking.booking_week = date_trunc(
                'week', option_row.starts_at at time zone 'America/Sao_Paulo'
              )::date
          )
        )
        order by option_row.starts_at, option_row.class_number
      ) from private.flexible_occurrences() option_row
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'booking_id', booking.id,
          'class_number', booking.class_number,
          'class_name', booking.class_name,
          'starts_at', slot.starts_at,
          'ends_at', slot.ends_at,
          'status', booking.status,
          'can_cancel', slot.starts_at > now(),
          'credit_deadline', slot.starts_at - interval '12 hours',
          'credit_if_cancelled', private.lesson_cancellation_grants_credit(
            slot.starts_at, now()
          ),
          'meeting_url', resources.video_lesson_url,
          'material_url', resources.lesson_material_url,
          'recorded_lessons_url', resources.recorded_lessons_url,
          'email_status', (
            select notification.status
            from public.makeup_class_email_notifications notification
            where notification.booking_id = booking.id
              and notification.notification_type = 'booking_confirmation'
          )
        ) order by slot.starts_at
      )
      from public.makeup_class_bookings booking
      join public.makeup_class_slots slot on slot.id = booking.slot_id
      left join public.class_resources resources
        on resources.class_number = booking.class_number
      where booking.student_id = caller
        and booking.booking_kind = 'flexible'
        and booking.status = 'confirmed'
        and slot.starts_at >= now() - interval '7 days'
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;
revoke all on function public.get_my_flexible_lessons() from public, anon;
grant execute on function public.get_my_flexible_lessons() to authenticated;

-- RPC dedicada, idempotente e restrita à reserva do aluno autenticado.
create function public.cancel_my_flexible_lesson(target_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  booking_status text;
  lesson_start timestamptz;
  cancellation_time timestamptz := now();
  credit_id uuid;
  credit_revoked_at timestamptz;
  credit_granted boolean;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar a aula.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  if not private.is_flexible_student(caller_id)
     or not exists (
       select 1 from public.profiles profile
       where profile.id = caller_id
         and profile.enrolled = true
         and coalesce(profile.archived, false) = false
     ) then
    raise exception 'Modalidade FLEXIVEL não autorizada.' using errcode = '42501';
  end if;

  select booking.status, slot.starts_at
  into booking_status, lesson_start
  from public.makeup_class_bookings booking
  join public.makeup_class_slots slot on slot.id = booking.slot_id
  where booking.id = target_booking_id
    and booking.student_id = caller_id
    and booking.booking_kind = 'flexible'
  for update of booking;

  if not found then
    raise exception 'Reserva não encontrada ou não pertence a este aluno.'
      using errcode = '42501';
  end if;

  if booking_status = 'cancelled' then
    return jsonb_build_object(
      'ok', true, 'already_cancelled', true,
      'booking_id', target_booking_id
    );
  end if;
  if booking_status <> 'confirmed' or lesson_start <= cancellation_time then
    raise exception 'Esta reserva já começou ou não pode mais ser cancelada.';
  end if;

  select credit.id, credit.revoked_at
  into credit_id, credit_revoked_at
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.makeup_booking_id = target_booking_id
    and credit.status = 'used'
  for update;

  if not found then
    raise exception 'Crédito da reserva não encontrado. Contate a administração.';
  end if;

  credit_granted := credit_revoked_at is null
    and private.lesson_cancellation_grants_credit(lesson_start, cancellation_time);

  update public.makeup_class_bookings booking
  set status = 'cancelled', cancelled_at = cancellation_time
  where booking.id = target_booking_id
    and booking.student_id = caller_id
    and booking.status = 'confirmed';

  insert into public.makeup_class_email_notifications (
    booking_id, notification_type
  ) values (target_booking_id, 'cancellation')
  on conflict (booking_id, notification_type) do nothing;

  return jsonb_build_object(
    'ok', true,
    'booking_id', target_booking_id,
    'credit_granted', credit_granted,
    'credit_id', credit_id
  );
end;
$function$;
revoke all on function public.cancel_my_flexible_lesson(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_my_flexible_lesson(uuid) to authenticated;

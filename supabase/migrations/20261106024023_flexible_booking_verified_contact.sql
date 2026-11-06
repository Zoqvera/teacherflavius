-- Use the verified Auth email for FLEXIVEL confirmations.
CREATE OR REPLACE FUNCTION public.book_my_flexible_lesson(target_class_number integer, target_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  target_credit_id uuid;
  target_week date;
  credit_row private.lesson_credits%rowtype;
  class_row public.teacher_classes%rowtype;
  class_resource_url text;
  local_start timestamp without time zone;
  capacity_limit integer;
  regular_students integer := 0;
  cancelled_regular_students integer := 0;
  replacement_students integer := 0;
  available_spots integer := 0;

  target_slot_id uuid;
  target_booking_id uuid;
  student_name text;
  student_email text;
begin
  if caller_id is null then
    raise exception 'Faça login para marcar uma aula FLEXIVEL.' using errcode = '42501';
  end if;

  if target_class_number is null or target_starts_at is null then
    raise exception 'Selecione uma aula válida.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
  if not private.is_flexible_student(caller_id) or not exists (
    select 1 from public.profiles where id=caller_id and enrolled and not archived
  ) then raise exception 'Modalidade FLEXIVEL não autorizada.' using errcode='42501'; end if;
  target_week := date_trunc('week', target_starts_at at time zone 'America/Sao_Paulo')::date;
  if exists(select 1 from public.makeup_class_bookings where student_id=caller_id
    and booking_kind='flexible' and booking_week=target_week and status='confirmed') then
    raise exception 'Você já reservou uma aula nesta semana.';
  end if;
  -- Use the same class row lock as the replacement RPC; recheck the shared seat pool.
  perform 1 from public.teacher_classes where class_number=target_class_number for update;
  if not exists(select 1 from private.flexible_occurrences() o
    where o.class_number=target_class_number and o.starts_at=target_starts_at) then
    raise exception 'Esta aula não possui vagas disponíveis ou está fora do prazo de reserva.';
  end if;
  target_credit_id := private.flexible_credit_for_date(caller_id,
    (target_starts_at at time zone 'America/Sao_Paulo')::date);
  select credit.*
  into credit_row
  from private.lesson_credits credit
  join public.monthly_tuition tuition
    on tuition.id = credit.tuition_id
  where credit.id = target_credit_id
    and credit.student_id = caller_id
    and credit.revoked_at is null
    and (
      credit.credit_origin = 'manual_grant'
      or tuition.payment_date is not null
      or coalesce(tuition.is_exempt, false) = true
    )
  for update of credit;

  if not found then
    raise exception 'Crédito disponível não encontrado.';
  end if;

  if credit_row.status <> 'available' then
    raise exception 'Este crédito não está disponível para aula FLEXIVEL.';
  end if;

  select class.*
  into class_row
  from public.teacher_classes class
  where class.class_number = target_class_number
    and class.is_active = true
    and class.class_type in ('quintet','individual')
  for update;

  if not found then
    raise exception 'A turma selecionada não está disponível para aula FLEXIVEL.';
  end if;

  if exists (
    select 1
    from public.class_students membership
    where membership.user_id = caller_id
      and membership.class_number = target_class_number
  ) then
    raise exception 'Escolha outra turma para a aula FLEXIVEL.';
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
    raise exception 'Você já possui uma aula FLEXIVEL confirmada neste horário.';
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

  available_spots := capacity_limit
    - (regular_students - cancelled_regular_students + replacement_students);
  if available_spots <= 0 then
    raise exception 'Esta turma não possui vaga disponível para aula FLEXIVEL. Escolha outra turma.';
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
        'Reserva FLEXIVEL',
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
    coalesce(user_account.email, '')
  into student_name, student_email
  from auth.users user_account
  left join public.profiles profile
    on profile.id = user_account.id
  where user_account.id = caller_id;

  if coalesce(student_email, '') = '' then
    raise exception 'Seu cadastro não possui e-mail. Atualize o perfil antes de marcar a aula FLEXIVEL.';
  end if;

  insert into public.makeup_class_bookings (
    slot_id,
    student_id,
    class_number,
    class_name,
    student_name,
    student_email,
    meeting_url,
    booking_kind,
    booking_week
  ) values (
    target_slot_id,
    caller_id,
    target_class_number,
    class_row.class_name,
    student_name,
    student_email,
    class_resource_url,
    'flexible',
    target_week
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
$function$;

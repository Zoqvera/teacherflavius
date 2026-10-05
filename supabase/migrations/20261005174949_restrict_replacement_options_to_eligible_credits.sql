-- Restrict replacement vacancies to credits earned by an on-time lesson cancellation.
-- Only class occurrences with exactly four available spots may be offered or booked.

create or replace function public.get_my_lessons_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  current_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  enrolled_classes jsonb := '[]'::jsonb;
  classes_per_month smallint;
  settled boolean := false;
  has_paid_before boolean := false;
  available_credits integer := 0;
  replacement_credit_ids jsonb := '[]'::jsonb;
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

  select exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  )
  into has_paid_before;

  select
    count(*)::integer,
    coalesce(
      jsonb_agg(to_jsonb(credit.id) order by credit.cancelled_at asc, credit.id asc),
      '[]'::jsonb
    )
  into available_credits, replacement_credit_ids
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.status = 'available'
    and credit.cancelled_at is not null
    and credit.regular_starts_at is not null
    and credit.cancelled_at <= credit.regular_starts_at - interval '12 hours';

  select count(*)::integer
  into current_month_credits
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.reference_month = current_month;

  return jsonb_build_object(
    'reference_month', current_month,
    'is_paid', settled,
    'has_paid_before', has_paid_before,
    'classes_per_month', classes_per_month,
    'available_credits', available_credits,
    'replacement_credit_ids', replacement_credit_ids,
    'current_month_credits', current_month_credits,
    'classes', enrolled_classes
  );
end;
$function$;

revoke execute on function public.get_my_lessons_overview() from public, anon;
grant execute on function public.get_my_lessons_overview() to authenticated, service_role;

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
as $function$
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
      and credit.cancelled_at is not null
      and credit.regular_starts_at is not null
      and credit.cancelled_at <= credit.regular_starts_at - interval '12 hours'
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
        - (snapshot.regular_students - snapshot.cancelled_regular_students + snapshot.replacement_students) = 4
  order by snapshot.starts_at asc, snapshot.class_name asc;
end;
$function$;

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
as $function$
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
  available_spots integer := 0;
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

  if credit_row.cancelled_at is null
     or credit_row.regular_starts_at is null
     or credit_row.cancelled_at > credit_row.regular_starts_at - interval '12 hours' then
    raise exception 'Este crédito não foi gerado por um cancelamento feito dentro do prazo.';
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

  available_spots := capacity_limit
    - (regular_students - cancelled_regular_students + replacement_students);

  if available_spots <> 4 then
    raise exception 'Esta turma não possui 4 vagas disponíveis para reposição. Escolha outra turma.';
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
$function$;

revoke execute on function public.book_my_lesson_replacement(uuid, integer, timestamptz) from public, anon;
grant execute on function public.book_my_lesson_replacement(uuid, integer, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';

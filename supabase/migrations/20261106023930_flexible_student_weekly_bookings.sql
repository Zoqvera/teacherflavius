-- FLEXIVEL is a booking modality; pedagogical class types stay independent.
create table private.flexible_students (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);
alter table private.flexible_students enable row level security;
revoke all on private.flexible_students from public, anon, authenticated;
grant all on private.flexible_students to service_role;

alter table public.makeup_class_bookings
  add column booking_kind text not null default 'replacement'
    check (booking_kind in ('replacement', 'flexible')),
  add column booking_week date;
alter table public.makeup_class_bookings add constraint flexible_booking_week_required
  check ((booking_kind = 'flexible') = (booking_week is not null));
create unique index one_flexible_booking_per_week
  on public.makeup_class_bookings(student_id, booking_week)
  where booking_kind = 'flexible' and status = 'confirmed';

create function private.is_flexible_student(target_student_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.flexible_students f
    where f.student_id = target_student_id and f.enabled);
$$;
revoke all on function private.is_flexible_student(uuid) from public, anon, authenticated;

create function public.get_teacher_student_booking_mode(target_student_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;
  return case when private.is_flexible_student(target_student_id) then 'FLEXIVEL' else 'FIXO' end;
end;
$$;
revoke all on function public.get_teacher_student_booking_mode(uuid) from public, anon;
grant execute on function public.get_teacher_student_booking_mode(uuid) to authenticated;

create function public.set_teacher_student_booking_mode(target_student_id uuid, target_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;
  if target_mode is null or target_mode not in ('FIXO','FLEXIVEL') then
    raise exception 'Modalidade inválida.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_student_id::text, 0));
  perform 1 from public.profiles where id = target_student_id and enrolled and not archived for update;
  if not found then raise exception 'Aluno ativo não encontrado.'; end if;
  if target_mode = 'FLEXIVEL' and (
    exists (select 1 from public.class_students where user_id = target_student_id)
    or exists (select 1 from private.lesson_credits where student_id = target_student_id
      and revoked_at is null and status = 'scheduled' and regular_starts_at > now())
  ) then
    raise exception 'Desvincule a turma fixa e ajuste as aulas futuras antes de ativar FLEXIVEL. Nenhuma aula paga será descartada automaticamente.';
  end if;
  insert into private.flexible_students(student_id, enabled, changed_by)
    values(target_student_id, target_mode = 'FLEXIVEL', auth.uid())
    on conflict(student_id) do update set enabled = excluded.enabled,
      changed_by = excluded.changed_by, changed_at = now();
  return jsonb_build_object('ok',true,'booking_mode',target_mode);
end;
$$;
revoke all on function public.set_teacher_student_booking_mode(uuid,text) from public, anon;
grant execute on function public.set_teacher_student_booking_mode(uuid,text) to authenticated;

-- Do not silently turn FLEXIVEL into a fixed enrollment via another screen.
create function private.guard_flexible_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
    if private.is_flexible_student(new.user_id) then
      raise exception 'Altere a modalidade para FIXO antes de vincular uma turma permanente.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_flexible_membership() from public, anon, authenticated;
create trigger guard_flexible_membership before insert or update of user_id on public.class_students
  for each row execute function private.guard_flexible_membership();

-- Every cancellation path, including legacy RPCs, must respect definitive reservations.
create function private.guard_flexible_booking_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.booking_kind = 'flexible' and auth.uid() is not null
     and not coalesce(public.is_teacher_admin(),false) then
    raise exception 'Reservas FLEXIVEL não podem ser canceladas ou alteradas pelo aluno.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_flexible_booking_change() from public, anon, authenticated;
create trigger guard_flexible_booking_change before update or delete on public.makeup_class_bookings
  for each row execute function private.guard_flexible_booking_change();

create function private.flexible_occurrences()
returns table(class_number integer,class_name text,starts_at timestamptz,ends_at timestamptz,available_spots integer)
language sql stable security definer set search_path = '' as $$
  with occurrences as (
    select c.class_number,c.class_name,
      (d.day::date + c.class_start_time) at time zone 'America/Sao_Paulo' as starts_at,
      private.get_class_operational_capacity(c.class_number)
        - private.count_class_seat_members(c.class_number)
        - private.count_class_seat_holds(c.class_number) as base_spots
    from public.teacher_classes c
    join public.class_resources r on r.class_number=c.class_number
    cross join generate_series((now() at time zone 'America/Sao_Paulo')::date::timestamp,
      (now() at time zone 'America/Sao_Paulo')::date::timestamp + interval '13 days',interval '1 day') d(day)
    where c.is_active and c.class_type in ('quintet','individual')
      and extract(isodow from d.day)=c.class_weekday
      and (c.first_lesson_date is null or d.day::date >= c.first_lesson_date)
      and r.video_lesson_url ~* '^https://' and r.lesson_material_url ~* '^https://'
      and r.recorded_lessons_url ~* '^https://'
  ), availability as (
    select o.*,
      o.base_spots + (
        select count(*)::integer from private.student_regular_lesson_cancellations x
        join public.class_students m on m.user_id=x.student_id and m.class_number=x.class_number
        join public.profiles p on p.id=m.user_id and p.enrolled and not p.archived
        where x.class_number=o.class_number
          and x.lesson_date=(o.starts_at at time zone 'America/Sao_Paulo')::date
      ) - (
        select count(*)::integer from public.makeup_class_bookings b
        join public.makeup_class_slots s on s.id=b.slot_id and s.is_active
        where b.class_number=o.class_number and s.starts_at=o.starts_at and b.status='confirmed'
      ) as spots
    from occurrences o
    where o.starts_at >= now() + interval '1 hour'
      and not exists(select 1 from private.academic_class_session_finalizations f
        where f.class_number=o.class_number and f.starts_at=o.starts_at)
  )
  select a.class_number,a.class_name,a.starts_at,a.starts_at + interval '1 hour',a.spots
  from availability a where a.spots>0 order by a.starts_at,a.class_number;
$$;
revoke all on function private.flexible_occurrences() from public, anon, authenticated;

create function private.flexible_credit_for_date(target_student_id uuid,target_date date)
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id from private.lesson_credits c
  join public.monthly_tuition t on t.id=c.tuition_id
  where c.student_id=target_student_id and c.credit_origin='contract'
    and c.status='available' and c.revoked_at is null and c.cancelled_at is null
    and c.regular_starts_at is null and c.makeup_booking_id is null
    and (t.payment_date is not null or coalesce(t.is_exempt,false))
    and private.get_tuition_coverage_start(t.id)<=target_date
    and target_date<private.get_tuition_coverage_end(t.id)
  order by t.due_date,c.credit_number limit 1;
$$;
revoke all on function private.flexible_credit_for_date(uuid,date) from public, anon, authenticated;

create function public.get_my_flexible_lessons()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result jsonb;
begin
  if caller is null then raise exception 'Faça login.' using errcode='42501'; end if;
  if not private.is_flexible_student(caller) then return null; end if;
  if not exists(select 1 from public.profiles where id=caller and enrolled and not archived) then
    raise exception 'Matrícula inativa.' using errcode='42501';
  end if;
  select jsonb_build_object('booking_mode','FLEXIVEL','options',coalesce((
    select jsonb_agg(to_jsonb(o) || jsonb_build_object('can_book',
      private.flexible_credit_for_date(caller,(o.starts_at at time zone 'America/Sao_Paulo')::date) is not null
      and not exists(select 1 from public.makeup_class_bookings b where b.student_id=caller
        and b.booking_kind='flexible' and b.status='confirmed'
        and b.booking_week=date_trunc('week',o.starts_at at time zone 'America/Sao_Paulo')::date)
    ) order by o.starts_at,o.class_number) from private.flexible_occurrences() o
  ),'[]'::jsonb),'bookings',coalesce((
    select jsonb_agg(jsonb_build_object('booking_id',b.id,'class_number',b.class_number,
      'class_name',b.class_name,'starts_at',s.starts_at,'ends_at',s.ends_at,'status',b.status,
      'meeting_url',r.video_lesson_url,'material_url',r.lesson_material_url,
      'recorded_lessons_url',r.recorded_lessons_url,
      'email_status',(select n.status from public.makeup_class_email_notifications n
        where n.booking_id=b.id and n.notification_type='booking_confirmation')) order by s.starts_at)
    from public.makeup_class_bookings b join public.makeup_class_slots s on s.id=b.slot_id
    left join public.class_resources r on r.class_number=b.class_number
    where b.student_id=caller and b.booking_kind='flexible' and b.status='confirmed'
      and s.starts_at>=now()-interval '7 days'
  ),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.get_my_flexible_lessons() from public, anon;
grant execute on function public.get_my_flexible_lessons() to authenticated;

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
    coalesce(nullif(trim(profile.email), ''), user_account.email, '')
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
revoke all on function public.book_my_flexible_lesson(integer,timestamptz) from public, anon;
grant execute on function public.book_my_flexible_lesson(integer,timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION private.student_replacement_target_type(target_student_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case upper(btrim(coalesce(profile.class_type, '')))
    when 'INDIVIDUAL' then 'individual'
    when 'QUINTETO' then 'quintet'
    else null
  end
  from public.profiles profile
  where not private.is_flexible_student(target_student_id)
    and profile.id = target_student_id
    and profile.enrolled = true
    and coalesce(profile.archived, false) = false
    and upper(btrim(coalesce(profile.class_type, ''))) in ('INDIVIDUAL', 'QUINTETO')
    and (
      upper(btrim(profile.class_type)) = 'QUINTETO'
      or exists (
        select 1
        from public.class_students membership
        join public.teacher_classes regular_class
          on regular_class.class_number = membership.class_number
         and regular_class.is_active = true
        where membership.user_id = profile.id
          and regular_class.class_type = 'individual'
      )
    )
  limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.cancel_my_regular_lesson(target_credit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
  cancellation_time timestamptz := now();
  credit_granted boolean := false;
  next_status text;
begin
  if private.is_flexible_student(auth.uid()) then
    raise exception 'Alunos FLEXIVEL não podem cancelar aulas.' using errcode='42501';
  end if;
  if caller_id is null then
    raise exception 'Faça login para cancelar sua aula.' using errcode = '42501';
  end if;

  select credit.*
  into credit_row
  from private.lesson_credits credit
  where credit.id = target_credit_id
    and credit.student_id = caller_id
    and credit.revoked_at is null
  for update;

  if not found then
    raise exception 'Crédito de aula não encontrado.';
  end if;

  if credit_row.status <> 'scheduled' or credit_row.regular_starts_at is null then
    raise exception 'Somente uma aula regular confirmada pode ser cancelada por esta ação.';
  end if;

  if cancellation_time < credit_row.regular_starts_at - interval '7 days' then
    raise exception 'Esta aula só poderá ser cancelada nos 7 dias anteriores ao início.';
  end if;

  if not private.lesson_can_be_cancelled(credit_row.regular_starts_at, cancellation_time) then
    raise exception 'Esta aula já começou e não pode mais ser cancelada.';
  end if;

  insert into private.student_regular_lesson_cancellations (
    student_id,
    class_number,
    lesson_date,
    cancelled_by
  ) values (
    caller_id,
    credit_row.regular_class_number,
    (credit_row.regular_starts_at at time zone 'America/Sao_Paulo')::date,
    caller_id
  )
  on conflict (student_id, class_number, lesson_date) do nothing;

  credit_granted := private.lesson_cancellation_grants_credit(
    credit_row.regular_starts_at,
    cancellation_time
  );
  next_status := case when credit_granted then 'available' else 'forfeited' end;

  update private.lesson_credits credit
  set
    status = next_status,
    cancelled_at = cancellation_time
  where credit.id = credit_row.id;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', next_status,
    'credit_granted', credit_granted
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.cancel_my_unpaid_lesson(target_class_number integer, target_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cancellation_time timestamptz := now();
  grants_replacement boolean;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Faça login para cancelar esta aula.' USING errcode = '42501';
  END IF;

  -- Serialize against payment and credit allocation for this student.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = caller_id
      AND profile.enrolled = true
      AND coalesce(profile.archived, false) = false
  ) THEN
    RAISE EXCEPTION 'Sua matrícula não está ativa.';
  END IF;

  IF target_starts_at IS NULL OR target_starts_at <= cancellation_time THEN
    RAISE EXCEPTION 'Esta aula já começou e não pode mais ser cancelada.';
  END IF;

  IF cancellation_time < target_starts_at - interval '7 days' THEN
    RAISE EXCEPTION 'Esta aula só poderá ser cancelada nos 7 dias anteriores ao início.';
  END IF;

  IF NOT private.lesson_can_be_cancelled(target_starts_at, cancellation_time) THEN
    RAISE EXCEPTION 'Esta aula não está disponível para cancelamento.';
  END IF;

  -- Verify the exact two forecast slots, rather than accepting arbitrary
  -- timestamps supplied by the browser.
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      coalesce(public.get_my_lesson_forecast()->'predicted_lessons', '[]'::jsonb)
    ) AS preview(lesson)
    WHERE (preview.lesson->>'class_number')::integer = target_class_number
      AND (preview.lesson->>'starts_at')::timestamptz = target_starts_at
      AND preview.lesson->>'status' = 'predicted'
      AND (preview.lesson->>'can_cancel')::boolean = true
  ) THEN
    RAISE EXCEPTION 'Esta aula não está disponível para cancelamento antecipado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.student_regular_lesson_cancellations cancellation
    WHERE cancellation.student_id = caller_id
      AND cancellation.class_number = target_class_number
      AND cancellation.lesson_date =
        (target_starts_at at time zone 'America/Sao_Paulo')::date
  ) THEN
    RAISE EXCEPTION 'Esta aula já foi cancelada.';
  END IF;

  grants_replacement := private.lesson_cancellation_grants_credit(
    target_starts_at, cancellation_time
  );

  INSERT INTO private.unpaid_lesson_cancellations (
    student_id, class_number, starts_at, cancelled_at, eligible_for_replacement
  ) VALUES (
    caller_id, target_class_number, target_starts_at,
    cancellation_time, grants_replacement
  );

  -- The same cancellation ledger also suppresses future class attendance.
  INSERT INTO private.student_regular_lesson_cancellations (
    student_id, class_number, lesson_date, cancelled_by
  ) VALUES (
    caller_id, target_class_number,
    (target_starts_at at time zone 'America/Sao_Paulo')::date,
    caller_id
  ) ON CONFLICT (student_id, class_number, lesson_date) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'credit_granted', false,
    'eligible_after_payment', grants_replacement
  );
END;
$function$;

-- A teacher cancellation releases the FLEXIVEL credit and its booking reference.
-- Preserve the historical behavior for replacement credits.
create or replace function private.release_lesson_credit_from_makeup_booking_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'confirmed' and new.status = 'cancelled' then
    update private.lesson_credits credit set status='available',used_at=null,
      makeup_booking_id=case when new.booking_kind='flexible' then null else credit.makeup_booking_id end
    where credit.makeup_booking_id=new.id and credit.student_id=new.student_id
      and credit.revoked_at is null and credit.status='used';
  end if;
  return new;
end;
$$;
revoke all on function private.release_lesson_credit_from_makeup_booking_trigger() from public, anon, authenticated;

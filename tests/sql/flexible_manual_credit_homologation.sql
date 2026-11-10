-- Executar somente contra banco com alunos FLEXIVEL e créditos manuais.
-- Todas as alterações e notificações pg_net são revertidas.
begin;

do $test$
declare
  fixture record;
  selected_credit_id uuid;
  booking_id uuid;
  booking_result jsonb;
  available_lessons jsonb;
begin
  select
    credit.student_id,
    occurrence.class_number,
    occurrence.starts_at
  into fixture
  from private.flexible_students as flexible
  join public.profiles as student
    on student.id = flexible.student_id
  join private.lesson_credits as credit
    on credit.student_id = student.id
  join public.monthly_tuition as tuition
    on tuition.id = credit.tuition_id
  cross join private.flexible_occurrences() as occurrence
  where flexible.enabled
    and student.enrolled
    and not coalesce(student.archived, false)
    and credit.credit_origin = 'manual_grant'
    and credit.status = 'available'
    and credit.revoked_at is null
    and credit.cancelled_at is null
    and credit.makeup_booking_id is null
    and credit.regular_starts_at is null
    and private.get_tuition_coverage_start(tuition.id)
      <= (occurrence.starts_at at time zone 'America/Sao_Paulo')::date
    and (occurrence.starts_at at time zone 'America/Sao_Paulo')::date
      < private.get_tuition_coverage_end(tuition.id)
    and not exists (
      select 1 from public.class_students as membership
      where membership.user_id = student.id
    )
    and not exists (
      select 1
      from public.makeup_class_bookings as booking
      where booking.student_id = student.id
        and booking.booking_kind = 'flexible'
        and booking.status = 'confirmed'
        and booking.booking_week =
          date_trunc('week', occurrence.starts_at at time zone 'America/Sao_Paulo')::date
    )
  order by occurrence.starts_at, credit.created_at
  limit 1;

  if fixture.student_id is null then
    raise exception 'Nenhum cenário de crédito manual FLEXIVEL disponível para homologação.';
  end if;

  -- Isola o crédito manual, sem excluir permanentemente créditos contratuais.
  update private.lesson_credits as credit
  set status = 'used'
  from public.monthly_tuition as tuition
  where credit.tuition_id = tuition.id
    and credit.student_id = fixture.student_id
    and credit.credit_origin = 'contract'
    and credit.status = 'available'
    and credit.revoked_at is null
    and credit.cancelled_at is null
    and credit.regular_starts_at is null
    and credit.makeup_booking_id is null
    and private.get_tuition_coverage_start(tuition.id)
      <= (fixture.starts_at at time zone 'America/Sao_Paulo')::date
    and (fixture.starts_at at time zone 'America/Sao_Paulo')::date
      < private.get_tuition_coverage_end(tuition.id);

  selected_credit_id := private.flexible_credit_for_date(
    fixture.student_id,
    (fixture.starts_at at time zone 'America/Sao_Paulo')::date
  );

  if not exists (
    select 1 from private.lesson_credits
    where id = selected_credit_id and credit_origin = 'manual_grant'
  ) then
    raise exception 'O selecionador não reconheceu o crédito manual.';
  end if;

  perform set_config('request.jwt.claim.sub', fixture.student_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', fixture.student_id, 'role', 'authenticated')::text,
    true
  );

  available_lessons := public.get_my_flexible_lessons();

  if not exists (
    select 1
    from jsonb_array_elements(available_lessons->'options') as option
    where (option->>'class_number')::integer = fixture.class_number
      and (option->>'starts_at')::timestamptz = fixture.starts_at
      and (option->>'can_book')::boolean
  ) then
    raise exception 'A opção de reserva não foi liberada para crédito manual.';
  end if;

  booking_result := public.book_my_flexible_lesson(
    fixture.class_number, fixture.starts_at
  );
  booking_id := (booking_result->>'booking_id')::uuid;

  if (booking_result->>'credit_id')::uuid is distinct from selected_credit_id
    or not exists (
      select 1 from private.lesson_credits
      where id = selected_credit_id
        and status = 'used'
        and makeup_booking_id = booking_id
    )
  then
    raise exception 'Reserva FLEXIVEL não consumiu o crédito manual.';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    (select user_id::text from public.teacher_admins order by created_at limit 1),
    true
  );

  update public.makeup_class_bookings
  set status = 'cancelled', cancelled_at = now()
  where id = booking_id;

  if not exists (
    select 1 from private.lesson_credits
    where id = selected_credit_id
      and status = 'available'
      and makeup_booking_id is null
  ) then
    raise exception 'Cancelamento do professor não restituiu o crédito manual.';
  end if;
end;
$test$;

rollback;

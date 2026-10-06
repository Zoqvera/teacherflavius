create or replace function private.enqueue_due_web_push_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inserted_count integer := 0;
  tuition_inserted_count integer := 0;
  current_local_date date := timezone('America/Sao_Paulo', now())::date;
begin
  with lesson_occurrences as (
    select
      credit.student_id,
      credit.id as credit_id,
      case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end as starts_at
    from private.lesson_credits credit
    left join public.makeup_class_bookings booking on booking.id = credit.makeup_booking_id
    left join public.makeup_class_slots slot on slot.id = booking.slot_id
    where credit.revoked_at is null
      and (
        (credit.status = 'scheduled' and credit.cancelled_at is null and credit.regular_starts_at > now())
        or
        (credit.status = 'used' and booking.status = 'confirmed' and slot.starts_at > now())
      )
  ),
  ranked_lessons as (
    select occurrence.*,
      row_number() over (
        partition by occurrence.student_id
        order by occurrence.starts_at asc, occurrence.credit_id asc
      ) as lesson_rank
    from lesson_occurrences occurrence
    where occurrence.starts_at is not null
  )
  insert into private.web_push_notification_deliveries (
    subscription_id, student_id, notification_type, subject_key,
    scheduled_for, title, body, target_url
  )
  select
    subscription.id,
    lesson.student_id,
    'lesson_13h',
    'lesson:' || lesson.credit_id::text || ':' ||
      floor(extract(epoch from lesson.starts_at))::bigint::text,
    lesson.starts_at - interval '13 hours',
    'Teacher Flávio',
    'Sua aula está próxima. Se você não puder participar, ainda dá tempo de cancelar e marcar uma reposição.',
    '/area-do-estudante/minhas-aulas/'
  from ranked_lessons lesson
  join private.web_push_subscriptions subscription
    on subscription.user_id = lesson.student_id
   and subscription.revoked_at is null
  where lesson.lesson_rank = 1
    and lesson.starts_at - interval '13 hours' <= now()
    and lesson.starts_at - interval '12 hours 50 minutes' > now()
  on conflict (subscription_id, notification_type, subject_key) do nothing;

  get diagnostics inserted_count = row_count;

  with due_tuitions as (
    select
      tuition.id,
      tuition.student_id,
      availability.effective_due_date as due_date
    from public.monthly_tuition tuition
    join public.profiles profile on profile.id = tuition.student_id
    cross join lateral private.get_tuition_student_availability(tuition.id) availability
    where tuition.payment_date is null
      and coalesce(tuition.is_exempt, false) = false
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and availability.available_on is not null
      and availability.available_on <= current_local_date
      and availability.effective_due_date in (current_local_date, current_local_date + 2)
  ),
  tuition_candidates as (
    select
      tuition.id,
      tuition.student_id,
      tuition.due_date,
      case when tuition.due_date = current_local_date + 2 then 'tuition_2d' else 'tuition_due' end as notification_type,
      case
        when tuition.due_date = current_local_date + 2
          then ((tuition.due_date - 2) + time '09:00') at time zone 'America/Sao_Paulo'
        else (tuition.due_date + time '09:00') at time zone 'America/Sao_Paulo'
      end as scheduled_for,
      case
        when tuition.due_date = current_local_date + 2
          then 'Sua mensalidade vence em dois dias, acesse o app e realize o pagamento para garantir sua permanência no curso.'
        else 'Sua mensalidade vence hoje, acesse o app e realize o pagamento para garantir sua permanência no curso.'
      end as notification_body
    from due_tuitions tuition
  )
  insert into private.web_push_notification_deliveries (
    subscription_id, student_id, notification_type, subject_key,
    scheduled_for, title, body, target_url
  )
  select
    subscription.id,
    tuition.student_id,
    tuition.notification_type,
    'tuition:' || tuition.id::text,
    tuition.scheduled_for,
    'Teacher Flávio',
    tuition.notification_body,
    '/pagamento/'
  from tuition_candidates tuition
  join private.web_push_subscriptions subscription
    on subscription.user_id = tuition.student_id
   and subscription.revoked_at is null
  where tuition.scheduled_for <= now()
  on conflict (subscription_id, notification_type, subject_key) do nothing;

  get diagnostics tuition_inserted_count = row_count;
  return inserted_count + tuition_inserted_count;
end;
$function$;

revoke all on function private.enqueue_due_web_push_notifications()
  from public, anon, authenticated;

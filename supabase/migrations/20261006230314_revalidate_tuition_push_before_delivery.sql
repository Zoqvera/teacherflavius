create or replace function public.claim_due_web_push_notifications(
  target_limit integer default 100
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  notification_title text,
  notification_body text,
  target_url text,
  notification_tag text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_local_date date := timezone('America/Sao_Paulo', now())::date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Acesso restrito ao serviço de notificações.' using errcode = '42501';
  end if;

  perform private.enqueue_due_web_push_notifications();

  update private.web_push_notification_deliveries delivery
  set
    status = 'expired',
    last_error = 'Lembrete invalidado pela regra vigente de liberação da mensalidade.'
  where delivery.notification_type in ('tuition_2d', 'tuition_due')
    and (
      delivery.status in ('pending', 'failed')
      or (
        delivery.status = 'sending'
        and delivery.last_attempt_at < now() - interval '10 minutes'
      )
    )
    and not exists (
      select 1
      from public.monthly_tuition tuition
      join public.profiles profile
        on profile.id = tuition.student_id
      cross join lateral private.get_tuition_student_availability(tuition.id) availability
      where tuition.student_id = delivery.student_id
        and delivery.subject_key = 'tuition:' || tuition.id::text
        and tuition.payment_date is null
        and coalesce(tuition.is_exempt, false) = false
        and coalesce(profile.enrolled, false) = true
        and coalesce(profile.archived, false) = false
        and availability.available_on is not null
        and availability.available_on <= current_local_date
        and (
          (
            delivery.notification_type = 'tuition_2d'
            and availability.effective_due_date = current_local_date + 2
          )
          or
          (
            delivery.notification_type = 'tuition_due'
            and availability.effective_due_date = current_local_date
          )
        )
    );

  return query
  with candidates as (
    select delivery.id
    from private.web_push_notification_deliveries delivery
    join private.web_push_subscriptions subscription
      on subscription.id = delivery.subscription_id
     and subscription.revoked_at is null
    where delivery.attempts < 3
      and delivery.scheduled_for <= now()
      and delivery.next_attempt_at <= now()
      and (
        delivery.status in ('pending', 'failed')
        or (
          delivery.status = 'sending'
          and delivery.last_attempt_at < now() - interval '10 minutes'
        )
      )
    order by delivery.scheduled_for asc, delivery.created_at asc
    for update of delivery skip locked
    limit greatest(1, least(coalesce(target_limit, 100), 200))
  ),
  claimed as (
    update private.web_push_notification_deliveries delivery
    set
      status = 'sending',
      attempts = delivery.attempts + 1,
      last_attempt_at = now(),
      last_error = null
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_secret,
    claimed.title,
    claimed.body,
    claimed.target_url,
    claimed.notification_type || ':' || claimed.subject_key
  from claimed
  join private.web_push_subscriptions subscription
    on subscription.id = claimed.subscription_id;
end;
$function$;

revoke all on function public.claim_due_web_push_notifications(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_web_push_notifications(integer)
  to service_role;

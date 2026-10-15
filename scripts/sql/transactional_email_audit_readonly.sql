-- Transactional email queue audit: aggregated operational counts only.
-- Does not return student identities, email addresses, webhook secrets or provider keys.
with all_notifications as (
  select 'matricula'::text as source, status, attempts, created_at, last_attempt_at
  from public.enrollment_email_notifications
  union all
  select 'reposicao'::text, status, attempts, created_at, last_attempt_at
  from public.makeup_class_email_notifications
  union all
  select 'cancelamento_regular'::text, status, attempts, created_at, last_attempt_at
  from public.regular_lesson_cancellation_email_notifications
)
select
  source,
  count(*) as total,
  count(*) filter (where status = 'sent') as accepted_by_provider,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status in ('pending', 'failed') and attempts >= 3) as attempts_exhausted,
  count(*) filter (where status in ('pending', 'failed')
    and created_at < now() - interval '18 hours') as outside_safe_retry_window,
  count(*) filter (where status in ('pending', 'failed')
    and attempts < 3
    and created_at between now() - interval '18 hours' and now() - interval '5 minutes'
    and (last_attempt_at is null or last_attempt_at <= now() - interval '10 minutes')
  ) as retry_eligible
from all_notifications
group by source
order by source;

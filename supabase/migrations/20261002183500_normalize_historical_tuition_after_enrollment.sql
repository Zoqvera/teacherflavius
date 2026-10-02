-- Normalize settled tuition rows only when the enrollment date is backed by
-- the enrollment notification trail. Preserve the original value in the audit log.

update public.profiles
set enrolled_at = timestamptz '2026-04-30 11:18:00-03'
where id = 'd6374ecd-db53-42e1-b909-83f46d4fc7d0'
  and name = 'Rodolfo Pires de Campos Junior';

with first_notification as (
  select student_id, min(created_at) as event_at
  from public.enrollment_email_notifications
  group by student_id
),
reliable_invalid as (
  select
    mt.id,
    mt.due_date as old_due_date,
    public.first_tuition_due_date_after(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      extract(day from mt.due_date)::integer
    ) as corrected_due_date,
    timezone('America/Sao_Paulo', p.enrolled_at)::date as enrollment_date
  from public.monthly_tuition mt
  join public.profiles p on p.id = mt.student_id
  join first_notification n on n.student_id = p.id
  where mt.payment_date is not null
    and p.enrolled_at is not null
    and abs(
      timezone('America/Sao_Paulo', n.event_at)::date
      - timezone('America/Sao_Paulo', p.created_at)::date
    ) <= 1
    and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
)
insert into public.monthly_tuition_events (
  tuition_id,
  action,
  actor_id,
  details
)
select
  r.id,
  'due_date_corrected_after_enrollment',
  null,
  jsonb_build_object(
    'old_due_date', r.old_due_date,
    'new_due_date', r.corrected_due_date,
    'enrollment_date', r.enrollment_date,
    'reason', 'historical_due_not_after_enrollment',
    'source', 'enrollment_notification'
  )
from reliable_invalid r;

with first_notification as (
  select student_id, min(created_at) as event_at
  from public.enrollment_email_notifications
  group by student_id
),
reliable_invalid as (
  select
    mt.id,
    public.first_tuition_due_date_after(
      timezone('America/Sao_Paulo', p.enrolled_at)::date,
      extract(day from mt.due_date)::integer
    ) as corrected_due_date
  from public.monthly_tuition mt
  join public.profiles p on p.id = mt.student_id
  join first_notification n on n.student_id = p.id
  where mt.payment_date is not null
    and p.enrolled_at is not null
    and abs(
      timezone('America/Sao_Paulo', n.event_at)::date
      - timezone('America/Sao_Paulo', p.created_at)::date
    ) <= 1
    and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
)
update public.monthly_tuition mt
set
  due_date = r.corrected_due_date,
  updated_at = now()
from reliable_invalid r
where mt.id = r.id;

do $validation$
begin
  if exists (
    select 1
    from public.monthly_tuition mt
    join public.profiles p on p.id = mt.student_id
    join (
      select student_id, min(created_at) as event_at
      from public.enrollment_email_notifications
      group by student_id
    ) n on n.student_id = p.id
    where p.enrolled_at is not null
      and abs(
        timezone('America/Sao_Paulo', n.event_at)::date
        - timezone('America/Sao_Paulo', p.created_at)::date
      ) <= 1
      and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
  ) then
    raise exception 'Ainda existem vencimentos anteriores à matrícula com data de matrícula confirmada.';
  end if;

  if exists (
    select 1
    from public.monthly_tuition mt
    join public.profiles p on p.id = mt.student_id
    where mt.payment_date is null
      and not mt.is_exempt
      and p.enrolled_at is not null
      and mt.due_date <= timezone('America/Sao_Paulo', p.enrolled_at)::date
  ) then
    raise exception 'Ainda existem cobranças abertas anteriores à matrícula.';
  end if;
end;
$validation$;

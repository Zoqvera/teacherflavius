create table if not exists public.payment_chargeback_documentation_cases (
  chargeback_id uuid primary key references public.payment_chargebacks(id) on delete cascade,
  preparation_status text not null default 'not_started' check (preparation_status in ('not_started','collecting','ready','submitted','closed')),
  internal_notes text,
  submission_marked_at timestamptz,
  submission_marked_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_chargeback_documentation_notes_length check (internal_notes is null or char_length(internal_notes) <= 4000)
);

create table if not exists public.payment_chargeback_evidence_items (
  id uuid primary key default gen_random_uuid(),
  chargeback_id uuid not null references public.payment_chargebacks(id) on delete cascade,
  category text not null check (category in ('service_delivery','terms_acceptance','customer_communication','payment_receipt','identity_or_order_reference','other')),
  label text not null,
  notes text,
  evidence_status text not null default 'needed' check (evidence_status in ('needed','collected','verified','included')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_chargeback_evidence_label_length check (char_length(label) between 1 and 180),
  constraint payment_chargeback_evidence_notes_length check (notes is null or char_length(notes) <= 2000)
);

create table if not exists public.payment_chargeback_documentation_events (
  id uuid primary key default gen_random_uuid(),
  chargeback_id uuid not null references public.payment_chargebacks(id) on delete cascade,
  evidence_id uuid references public.payment_chargeback_evidence_items(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('case_updated','evidence_added','evidence_updated','evidence_removed','submission_marked')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_chargeback_documentation_cases_updated_by_idx on public.payment_chargeback_documentation_cases(updated_by);
create index if not exists payment_chargeback_documentation_cases_submission_by_idx on public.payment_chargeback_documentation_cases(submission_marked_by);
create index if not exists payment_chargeback_evidence_chargeback_idx on public.payment_chargeback_evidence_items(chargeback_id, evidence_status);
create index if not exists payment_chargeback_evidence_created_by_idx on public.payment_chargeback_evidence_items(created_by);
create index if not exists payment_chargeback_evidence_updated_by_idx on public.payment_chargeback_evidence_items(updated_by);
create index if not exists payment_chargeback_documentation_events_chargeback_idx on public.payment_chargeback_documentation_events(chargeback_id, created_at desc);
create index if not exists payment_chargeback_documentation_events_evidence_idx on public.payment_chargeback_documentation_events(evidence_id);
create index if not exists payment_chargeback_documentation_events_actor_idx on public.payment_chargeback_documentation_events(actor_user_id);

alter table public.payment_chargeback_documentation_cases enable row level security;
alter table public.payment_chargeback_evidence_items enable row level security;
alter table public.payment_chargeback_documentation_events enable row level security;
revoke all on public.payment_chargeback_documentation_cases from public, anon, authenticated;
revoke all on public.payment_chargeback_evidence_items from public, anon, authenticated;
revoke all on public.payment_chargeback_documentation_events from public, anon, authenticated;
grant select, insert, update, delete on public.payment_chargeback_documentation_cases to service_role;
grant select, insert, update, delete on public.payment_chargeback_evidence_items to service_role;
grant select, insert on public.payment_chargeback_documentation_events to service_role;

create or replace function public.list_mercado_pago_chargeback_documentation_cases(target_reference_month date)
returns table (
  chargeback_id uuid,
  provider_chargeback_id text,
  tuition_id uuid,
  amount numeric,
  currency text,
  reason text,
  coverage_eligible boolean,
  documentation_status text,
  documentation_deadline timestamptz,
  operational_status text,
  payment_status text,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  preparation_status text,
  internal_notes text,
  submission_marked_at timestamptz,
  evidence_total integer,
  evidence_included integer
)
language sql
security definer
set search_path = ''
as $function$
  select
    cb.id,
    cb.provider_chargeback_id,
    cb.tuition_id,
    cb.amount,
    cb.currency,
    cb.reason,
    cb.coverage_eligible,
    cb.documentation_status,
    cb.documentation_deadline,
    cb.operational_status,
    cb.payment_status,
    cb.provider_created_at,
    cb.provider_updated_at,
    coalesce(doc.preparation_status, 'not_started'),
    doc.internal_notes,
    doc.submission_marked_at,
    coalesce(ev.total_count, 0)::integer,
    coalesce(ev.included_count, 0)::integer
  from public.payment_chargebacks cb
  join public.monthly_tuition tuition on tuition.id = cb.tuition_id
  left join public.payment_chargeback_documentation_cases doc on doc.chargeback_id = cb.id
  left join lateral (
    select count(*) as total_count,
           count(*) filter (where item.evidence_status = 'included') as included_count
    from public.payment_chargeback_evidence_items item
    where item.chargeback_id = cb.id
  ) ev on true
  where tuition.reference_month = date_trunc('month', coalesce(target_reference_month, current_date))::date
  order by cb.provider_created_at desc nulls last, cb.created_at desc;
$function$;

create or replace function public.get_mercado_pago_chargeback_documentation(target_chargeback_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'case', jsonb_build_object(
      'chargeback_id', cb.id,
      'provider_chargeback_id', cb.provider_chargeback_id,
      'documentation_status', cb.documentation_status,
      'documentation_deadline', cb.documentation_deadline,
      'operational_status', cb.operational_status,
      'preparation_status', coalesce(doc.preparation_status, 'not_started'),
      'internal_notes', doc.internal_notes,
      'submission_marked_at', doc.submission_marked_at
    ),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'category', item.category,
        'label', item.label,
        'notes', item.notes,
        'status', item.evidence_status,
        'created_at', item.created_at,
        'updated_at', item.updated_at
      ) order by item.created_at, item.id)
      from public.payment_chargeback_evidence_items item
      where item.chargeback_id = cb.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', evt.id,
        'action', evt.action,
        'details', evt.details,
        'created_at', evt.created_at
      ) order by evt.created_at desc)
      from (
        select * from public.payment_chargeback_documentation_events e
        where e.chargeback_id = cb.id
        order by e.created_at desc
        limit 50
      ) evt
    ), '[]'::jsonb)
  )
  from public.payment_chargebacks cb
  left join public.payment_chargeback_documentation_cases doc on doc.chargeback_id = cb.id
  where cb.id = target_chargeback_id;
$function$;

create or replace function public.save_mercado_pago_chargeback_documentation_case(
  target_chargeback_id uuid,
  target_preparation_status text,
  target_internal_notes text,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_status text := lower(trim(coalesce(target_preparation_status, '')));
  normalized_notes text := nullif(trim(coalesce(target_internal_notes, '')), '');
begin
  if normalized_status not in ('not_started','collecting','ready','submitted','closed') then
    raise exception 'Invalid preparation status' using errcode = '22023';
  end if;
  if normalized_notes is not null and char_length(normalized_notes) > 4000 then
    raise exception 'Internal notes are too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.payment_chargebacks where id = target_chargeback_id) then
    raise exception 'Chargeback not found' using errcode = 'P0002';
  end if;

  insert into public.payment_chargeback_documentation_cases(chargeback_id, preparation_status, internal_notes, updated_by)
  values (target_chargeback_id, normalized_status, normalized_notes, target_actor_user_id)
  on conflict (chargeback_id) do update set
    preparation_status = excluded.preparation_status,
    internal_notes = excluded.internal_notes,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.payment_chargeback_documentation_events(chargeback_id, actor_user_id, action, details)
  values (target_chargeback_id, target_actor_user_id, 'case_updated', jsonb_build_object('preparation_status', normalized_status));

  return public.get_mercado_pago_chargeback_documentation(target_chargeback_id);
end;
$function$;

create or replace function public.add_mercado_pago_chargeback_evidence(
  target_chargeback_id uuid,
  target_category text,
  target_label text,
  target_notes text,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_category text := lower(trim(coalesce(target_category, '')));
  normalized_label text := trim(coalesce(target_label, ''));
  normalized_notes text := nullif(trim(coalesce(target_notes, '')), '');
  new_id uuid;
begin
  if normalized_category not in ('service_delivery','terms_acceptance','customer_communication','payment_receipt','identity_or_order_reference','other') then
    raise exception 'Invalid evidence category' using errcode = '22023';
  end if;
  if char_length(normalized_label) < 1 or char_length(normalized_label) > 180 then
    raise exception 'Invalid evidence label' using errcode = '22023';
  end if;
  if normalized_notes is not null and char_length(normalized_notes) > 2000 then
    raise exception 'Evidence notes are too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.payment_chargebacks where id = target_chargeback_id) then
    raise exception 'Chargeback not found' using errcode = 'P0002';
  end if;

  insert into public.payment_chargeback_evidence_items(chargeback_id, category, label, notes, created_by, updated_by)
  values (target_chargeback_id, normalized_category, normalized_label, normalized_notes, target_actor_user_id, target_actor_user_id)
  returning id into new_id;

  insert into public.payment_chargeback_documentation_events(chargeback_id, evidence_id, actor_user_id, action, details)
  values (target_chargeback_id, new_id, target_actor_user_id, 'evidence_added', jsonb_build_object('category', normalized_category, 'label', normalized_label));

  return public.get_mercado_pago_chargeback_documentation(target_chargeback_id);
end;
$function$;

create or replace function public.update_mercado_pago_chargeback_evidence(
  target_evidence_id uuid,
  target_status text,
  target_label text,
  target_notes text,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_status text := lower(trim(coalesce(target_status, '')));
  normalized_label text := trim(coalesce(target_label, ''));
  normalized_notes text := nullif(trim(coalesce(target_notes, '')), '');
  target_chargeback_id uuid;
begin
  if normalized_status not in ('needed','collected','verified','included') then
    raise exception 'Invalid evidence status' using errcode = '22023';
  end if;
  if char_length(normalized_label) < 1 or char_length(normalized_label) > 180 then
    raise exception 'Invalid evidence label' using errcode = '22023';
  end if;
  if normalized_notes is not null and char_length(normalized_notes) > 2000 then
    raise exception 'Evidence notes are too long' using errcode = '22023';
  end if;

  update public.payment_chargeback_evidence_items
  set evidence_status = normalized_status,
      label = normalized_label,
      notes = normalized_notes,
      updated_by = target_actor_user_id,
      updated_at = now()
  where id = target_evidence_id
  returning chargeback_id into target_chargeback_id;
  if target_chargeback_id is null then
    raise exception 'Evidence not found' using errcode = 'P0002';
  end if;

  insert into public.payment_chargeback_documentation_events(chargeback_id, evidence_id, actor_user_id, action, details)
  values (target_chargeback_id, target_evidence_id, target_actor_user_id, 'evidence_updated', jsonb_build_object('status', normalized_status, 'label', normalized_label));

  return public.get_mercado_pago_chargeback_documentation(target_chargeback_id);
end;
$function$;

create or replace function public.delete_mercado_pago_chargeback_evidence(
  target_evidence_id uuid,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_chargeback_id uuid;
  removed_label text;
begin
  delete from public.payment_chargeback_evidence_items
  where id = target_evidence_id
  returning chargeback_id, label into target_chargeback_id, removed_label;
  if target_chargeback_id is null then
    raise exception 'Evidence not found' using errcode = 'P0002';
  end if;

  insert into public.payment_chargeback_documentation_events(chargeback_id, actor_user_id, action, details)
  values (target_chargeback_id, target_actor_user_id, 'evidence_removed', jsonb_build_object('label', removed_label));

  return public.get_mercado_pago_chargeback_documentation(target_chargeback_id);
end;
$function$;

create or replace function public.mark_mercado_pago_chargeback_documentation_submitted(
  target_chargeback_id uuid,
  target_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cb record;
  included_count integer;
  current_preparation text;
begin
  select id, operational_status, documentation_status, documentation_deadline
    into cb
  from public.payment_chargebacks
  where id = target_chargeback_id
  for update;
  if cb.id is null then raise exception 'Chargeback not found' using errcode = 'P0002'; end if;
  if cb.operational_status <> 'open' then raise exception 'Chargeback is not open' using errcode = '22023'; end if;
  if cb.documentation_status <> 'pending' then raise exception 'Provider is not accepting documentation' using errcode = '22023'; end if;
  if cb.documentation_deadline is not null and cb.documentation_deadline < now() then raise exception 'Documentation deadline has expired' using errcode = '22023'; end if;

  select preparation_status into current_preparation
  from public.payment_chargeback_documentation_cases
  where chargeback_id = target_chargeback_id;
  if current_preparation <> 'ready' then raise exception 'Documentation case is not ready' using errcode = '22023'; end if;

  select count(*)::integer into included_count
  from public.payment_chargeback_evidence_items
  where chargeback_id = target_chargeback_id and evidence_status = 'included';
  if included_count < 1 then raise exception 'At least one included evidence item is required' using errcode = '22023'; end if;

  update public.payment_chargeback_documentation_cases
  set preparation_status = 'submitted', submission_marked_at = now(), submission_marked_by = target_actor_user_id,
      updated_by = target_actor_user_id, updated_at = now()
  where chargeback_id = target_chargeback_id;

  insert into public.payment_chargeback_documentation_events(chargeback_id, actor_user_id, action, details)
  values (target_chargeback_id, target_actor_user_id, 'submission_marked', jsonb_build_object('included_evidence_count', included_count));

  return public.get_mercado_pago_chargeback_documentation(target_chargeback_id);
end;
$function$;

revoke all on function public.list_mercado_pago_chargeback_documentation_cases(date) from public, anon, authenticated;
revoke all on function public.get_mercado_pago_chargeback_documentation(uuid) from public, anon, authenticated;
revoke all on function public.save_mercado_pago_chargeback_documentation_case(uuid,text,text,uuid) from public, anon, authenticated;
revoke all on function public.add_mercado_pago_chargeback_evidence(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.update_mercado_pago_chargeback_evidence(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.delete_mercado_pago_chargeback_evidence(uuid,uuid) from public, anon, authenticated;
revoke all on function public.mark_mercado_pago_chargeback_documentation_submitted(uuid,uuid) from public, anon, authenticated;
grant execute on function public.list_mercado_pago_chargeback_documentation_cases(date) to service_role;
grant execute on function public.get_mercado_pago_chargeback_documentation(uuid) to service_role;
grant execute on function public.save_mercado_pago_chargeback_documentation_case(uuid,text,text,uuid) to service_role;
grant execute on function public.add_mercado_pago_chargeback_evidence(uuid,text,text,text,uuid) to service_role;
grant execute on function public.update_mercado_pago_chargeback_evidence(uuid,text,text,text,uuid) to service_role;
grant execute on function public.delete_mercado_pago_chargeback_evidence(uuid,uuid) to service_role;
grant execute on function public.mark_mercado_pago_chargeback_documentation_submitted(uuid,uuid) to service_role;

alter table public.payment_alert_notifications drop constraint if exists payment_alert_notifications_type_check;
alter table public.payment_alert_notifications add constraint payment_alert_notifications_type_check check (alert_type in (
  'reconciliation_failure','reconciliation_stalled','duplicate_payment','approved_without_application','payment_reversal',
  'payment_reversal_pending','invalid_webhook_burst','gateway_failure','chargeback_opened','chargeback_documentation_deadline'
));

create or replace function private.scan_payment_alert_conditions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  approved_count integer := 0;
  reversal_count integer := 0;
  retried_count integer := 0;
  stalled_count integer := 0;
  timed_out_runs integer := 0;
  deleted_runs integer := 0;
  documentation_deadline_count integer := 0;
  minutes_since_success integer;
  last_success_at timestamptz;
  attempt_row record;
  chargeback_row record;
  deadline_tier text;
  deadline_severity text;
  hours_remaining integer;
begin
  update public.payment_reconciliation_runs run
  set status = 'failed', completed_at = now(), error_code = coalesce(run.error_code, 'run_timeout')
  where run.status = 'running' and run.started_at < now() - interval '15 minutes';
  get diagnostics timed_out_runs = row_count;

  select max(run.completed_at) into last_success_at
  from public.payment_reconciliation_runs run where run.status = 'succeeded';
  if last_success_at is null or last_success_at < now() - interval '15 minutes' then
    minutes_since_success := case when last_success_at is null then null else floor(extract(epoch from (now() - last_success_at)) / 60)::integer end;
    perform private.enqueue_payment_alert('reconciliation_stalled','warning','reconciliation_stalled:' || coalesce(to_char(last_success_at at time zone 'UTC','YYYYMMDDHH24MISSMS'),'never'),null,null,null,pg_catalog.jsonb_build_object('last_success_at',last_success_at,'minutes_since_success',minutes_since_success));
    stalled_count := 1;
  end if;

  for attempt_row in select attempt.id, attempt.tuition_id, attempt.provider_payment_id, attempt.status from public.tuition_payment_attempts attempt where attempt.status='approved' and attempt.applied_at is null and attempt.updated_at < now()-interval '2 minutes' loop
    perform private.enqueue_payment_alert('approved_without_application','critical','approved_without_application:'||attempt_row.id::text,attempt_row.tuition_id,attempt_row.id,attempt_row.provider_payment_id,pg_catalog.jsonb_build_object('payment_status',attempt_row.status));
    approved_count := approved_count + 1;
  end loop;

  for attempt_row in select attempt.id, attempt.tuition_id, attempt.provider_payment_id, attempt.status from public.tuition_payment_attempts attempt where attempt.status in ('cancelled','refunded','charged_back') and attempt.applied_at is not null and attempt.reversed_at is null and attempt.updated_at < now()-interval '2 minutes' loop
    perform private.enqueue_payment_alert('payment_reversal_pending','critical','payment_reversal_pending:'||attempt_row.id::text||':'||attempt_row.status,attempt_row.tuition_id,attempt_row.id,attempt_row.provider_payment_id,pg_catalog.jsonb_build_object('provider_status',attempt_row.status));
    reversal_count := reversal_count + 1;
  end loop;

  for chargeback_row in
    select cb.id, cb.provider_chargeback_id, cb.tuition_id, cb.attempt_id, cb.provider_payment_id,
           cb.documentation_status, cb.documentation_deadline, coalesce(doc.preparation_status,'not_started') as preparation_status
    from public.payment_chargebacks cb
    left join public.payment_chargeback_documentation_cases doc on doc.chargeback_id = cb.id
    where cb.operational_status='open' and cb.documentation_status='pending' and cb.documentation_deadline is not null
      and cb.documentation_deadline <= now() + interval '72 hours'
  loop
    hours_remaining := floor(extract(epoch from (chargeback_row.documentation_deadline - now())) / 3600)::integer;
    if chargeback_row.documentation_deadline < now() then deadline_tier := 'overdue'; deadline_severity := 'critical';
    elsif chargeback_row.documentation_deadline <= now() + interval '24 hours' then deadline_tier := '24h'; deadline_severity := 'critical';
    else deadline_tier := '72h'; deadline_severity := 'warning'; end if;

    perform private.enqueue_payment_alert(
      'chargeback_documentation_deadline', deadline_severity,
      'chargeback_documentation_deadline:'||chargeback_row.provider_chargeback_id||':'||deadline_tier,
      chargeback_row.tuition_id, chargeback_row.attempt_id, chargeback_row.provider_payment_id,
      pg_catalog.jsonb_build_object('chargeback_id',chargeback_row.provider_chargeback_id,'documentation_status',chargeback_row.documentation_status,'documentation_deadline',chargeback_row.documentation_deadline,'hours_remaining',hours_remaining,'preparation_status',chargeback_row.preparation_status,'deadline_tier',deadline_tier)
    );
    documentation_deadline_count := documentation_deadline_count + 1;
  end loop;

  update public.payment_alert_notifications alert set status='pending', updated_at=now()
  where alert.status='failed' and alert.attempts<5 and coalesce(alert.last_attempt_at,alert.created_at)<now()-interval '10 minutes';
  get diagnostics retried_count = row_count;

  delete from public.payment_reconciliation_runs run where run.status in ('succeeded','failed') and run.completed_at < now()-interval '90 days';
  get diagnostics deleted_runs = row_count;

  return pg_catalog.jsonb_build_object('approved_without_application',approved_count,'payment_reversal_pending',reversal_count,'reconciliation_stalled',stalled_count,'chargeback_documentation_deadline',documentation_deadline_count,'timed_out_reconciliation_runs',timed_out_runs,'retried_alerts',retried_count,'deleted_reconciliation_runs',deleted_runs,'last_reconciliation_success_at',last_success_at);
end;
$function$;
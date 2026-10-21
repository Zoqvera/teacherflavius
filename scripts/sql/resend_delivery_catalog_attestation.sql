-- Read-only attestation: the manually applied Resend migration has an
-- empty SQL snapshot in Supabase's migration ledger. Return only 't' when
-- the pinned migration identity, schema, and security controls are intact.
with required_columns(table_name, column_name, data_type, nullable) as (
  values
  ('resend_delivery_events','provider_event_id','text','NO'),
  ('resend_delivery_events','provider_email_id','text','NO'),
  ('resend_delivery_events','event_type','text','NO'),
  ('resend_delivery_events','occurred_at','timestamp with time zone','NO'),
  ('resend_delivery_events','received_at','timestamp with time zone','NO'),
  ('resend_delivery_messages','provider_email_id','text','NO'),
  ('resend_delivery_messages','queue_name','text','NO'),
  ('resend_delivery_messages','notification_id','uuid','NO'),
  ('resend_delivery_messages','recipient_role','text','NO'),
  ('resend_delivery_messages','accepted_at','timestamp with time zone','NO'),
  ('resend_delivery_messages','delivery_status','text','NO'),
  ('resend_delivery_messages','last_event_at','timestamp with time zone','YES')
),
required_indexes(name) as (
  values ('resend_delivery_events_email_timeline_idx'),
    ('resend_delivery_events_pkey'),('resend_delivery_events_retention_idx'),
    ('resend_delivery_messages_notification_idx'),
    ('resend_delivery_messages_pkey'),
    ('resend_delivery_messages_queue_name_notification_id_recipie_key'),
    ('resend_delivery_messages_retention_idx')
),
required_constraints(name) as (
  values ('resend_delivery_events_event_type_check'),
    ('resend_delivery_events_pkey'),
    ('resend_delivery_events_provider_email_id_check'),
    ('resend_delivery_events_provider_event_id_check'),
    ('resend_delivery_messages_delivery_status_check'),
    ('resend_delivery_messages_pkey'),
    ('resend_delivery_messages_provider_email_id_check'),
    ('resend_delivery_messages_queue_name_check'),
    ('resend_delivery_messages_queue_name_notification_id_recipie_key'),
    ('resend_delivery_messages_recipient_role_check')
)
select (
  (select count(*) = 1 from supabase_migrations.schema_migrations
    where version = '20261016213000'
      and name = 'resend_delivery_tracking_and_retention'
      and coalesce(cardinality(statements), 0) = 0)
  and to_regclass('private.resend_delivery_messages') is not null
  and to_regclass('private.resend_delivery_events') is not null
  and (select count(*) = 2 from pg_class
    where oid in (to_regclass('private.resend_delivery_messages'),
                  to_regclass('private.resend_delivery_events'))
      and relkind = 'r' and relrowsecurity)
  and (select count(*) = 12 from information_schema.columns
    where table_schema = 'private'
      and table_name in ('resend_delivery_messages','resend_delivery_events'))
  and (select count(*) = 12 from required_columns r
    join information_schema.columns c on c.table_schema = 'private'
      and c.table_name = r.table_name and c.column_name = r.column_name
      and c.data_type = r.data_type and c.is_nullable = r.nullable)
  and (select count(*) = 7 from pg_indexes
    where schemaname = 'private'
      and tablename in ('resend_delivery_messages','resend_delivery_events'))
  and (select count(*) = 7 from required_indexes r
    join pg_indexes i on i.schemaname = 'private' and i.indexname = r.name
    where i.tablename in ('resend_delivery_messages','resend_delivery_events'))
  and (select count(*) = 10 from pg_constraint
    where conrelid in (to_regclass('private.resend_delivery_messages'),
                       to_regclass('private.resend_delivery_events')))
  and (select count(*) = 10 from required_constraints r
    join pg_constraint c on c.conname = r.name
    where c.conrelid in (to_regclass('private.resend_delivery_messages'),
                         to_regclass('private.resend_delivery_events')))
  and exists (select 1 from pg_constraint
    where conrelid = to_regclass('private.resend_delivery_messages')
      and conname = 'resend_delivery_messages_queue_name_check'
      and pg_get_constraintdef(oid) like '%regular_cancellation%')
  and exists (select 1 from pg_constraint
    where conrelid = to_regclass('private.resend_delivery_events')
      and conname = 'resend_delivery_events_event_type_check'
      and pg_get_constraintdef(oid) like '%email.delivered%')
  and (select count(*) = 0 from pg_policies
    where schemaname = 'private'
      and tablename in ('resend_delivery_messages','resend_delivery_events'))
  and not has_table_privilege('anon','private.resend_delivery_messages','SELECT')
  and not has_table_privilege('authenticated','private.resend_delivery_messages','SELECT')
  and not has_table_privilege('anon','private.resend_delivery_events','SELECT')
  and not has_table_privilege('authenticated','private.resend_delivery_events','SELECT')
  and not has_table_privilege('anon','private.resend_delivery_messages','INSERT')
  and not has_table_privilege('authenticated','private.resend_delivery_messages','INSERT')
  and not has_table_privilege('anon','private.resend_delivery_events','INSERT')
  and not has_table_privilege('authenticated','private.resend_delivery_events','INSERT')
  and has_table_privilege('service_role','private.resend_delivery_messages','SELECT')
  and has_table_privilege('service_role','private.resend_delivery_events','SELECT')
  and to_regprocedure('public.record_resend_message_acceptance(text,uuid,text,text)') is not null
  and to_regprocedure('public.record_resend_delivery_event(text,text,text,timestamptz)') is not null
  and to_regprocedure('public.prune_resend_delivery_evidence(integer)') is not null
  and to_regprocedure('private.refresh_resend_delivery_status(text)') is not null
  and not has_function_privilege('anon','public.record_resend_message_acceptance(text,uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_resend_message_acceptance(text,uuid,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.record_resend_delivery_event(text,text,text,timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_resend_delivery_event(text,text,text,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.prune_resend_delivery_evidence(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.prune_resend_delivery_evidence(integer)','EXECUTE')
  and not has_function_privilege('authenticated','private.refresh_resend_delivery_status(text)','EXECUTE')
  and has_function_privilege('service_role','public.record_resend_message_acceptance(text,uuid,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.record_resend_delivery_event(text,text,text,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','public.prune_resend_delivery_evidence(integer)','EXECUTE')
  and (select prosecdef from pg_proc where oid=to_regprocedure('public.record_resend_message_acceptance(text,uuid,text,text)'))
  and (select prosecdef from pg_proc where oid=to_regprocedure('public.record_resend_delivery_event(text,text,text,timestamptz)'))
  and not (select prosecdef from pg_proc where oid=to_regprocedure('public.prune_resend_delivery_evidence(integer)'))
  and position('90 days' in pg_get_functiondef('public.prune_resend_delivery_evidence(integer)'::regprocedure)) > 0
  and position('180 days' in pg_get_functiondef('public.prune_resend_delivery_evidence(integer)'::regprocedure)) > 0
  and position('for update skip locked' in lower(pg_get_functiondef('public.prune_resend_delivery_evidence(integer)'::regprocedure))) > 0
  and position('on conflict (provider_event_id) do nothing' in lower(pg_get_functiondef('public.record_resend_delivery_event(text,text,text,timestamptz)'::regprocedure))) > 0
) as attested;

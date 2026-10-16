-- Run only in disposable PostgreSQL after the tracking fixture, inside
-- the surrounding transaction; the caller must ROLLBACK after this file.
\set ON_ERROR_STOP on

do $retention_cases$
declare
  cutoff_result jsonb;
  repeat_result jsonb;
  blocked boolean;
begin
  if has_function_privilege(
    'anon', 'public.prune_resend_delivery_evidence(integer)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.prune_resend_delivery_evidence(integer)', 'EXECUTE'
  ) then
    raise exception 'Retention must not be callable by browser roles';
  end if;

  if has_table_privilege(
    'anon', 'private.resend_delivery_events', 'DELETE'
  ) or has_table_privilege(
    'authenticated', 'private.resend_delivery_messages', 'DELETE'
  ) then
    raise exception 'Browser roles must not delete delivery evidence';
  end if;

  if not has_function_privilege(
    'service_role', 'public.prune_resend_delivery_evidence(integer)', 'EXECUTE'
  ) then
    raise exception 'Service role must be able to run retention';
  end if;

  -- Received-time is authoritative for event retention. The original
  -- occurrence time is NOT used to shorten retention for delayed deliveries.
  update private.resend_delivery_events
     set received_at = statement_timestamp() - interval '91 days'
   where provider_event_id = 'msg_resend_fixture_02';

  update private.resend_delivery_events
     set received_at = statement_timestamp() - interval '89 days'
   where provider_event_id = 'msg_resend_fixture_01';

  update private.resend_delivery_messages
     set accepted_at = statement_timestamp() - interval '181 days'
   where provider_email_id = 'resend_fixture_teacher_01';

  update private.resend_delivery_messages
     set accepted_at = statement_timestamp() - interval '179 days'
   where provider_email_id = 'resend_fixture_student_01';

  cutoff_result := public.prune_resend_delivery_evidence(1);
  if cutoff_result <> '{"events_deleted": 1, "messages_deleted": 1}'::jsonb then
    raise exception 'Retention should delete exactly one expired record per table: %', cutoff_result;
  end if;

  if exists (
    select 1 from private.resend_delivery_events
     where provider_event_id = 'msg_resend_fixture_02'
  ) or exists (
    select 1 from private.resend_delivery_messages
     where provider_email_id = 'resend_fixture_teacher_01'
  ) then
    raise exception 'Expired delivery evidence was retained';
  end if;

  if not exists (
    select 1 from private.resend_delivery_events
     where provider_event_id = 'msg_resend_fixture_01'
  ) or not exists (
    select 1 from private.resend_delivery_messages
     where provider_email_id = 'resend_fixture_student_01'
  ) then
    raise exception 'Unexpired delivery evidence was deleted';
  end if;

  if (select delivery_status from private.resend_delivery_messages
      where provider_email_id = 'resend_fixture_student_01') <> 'bounced' then
    raise exception 'Event cleanup must not erase the message delivery summary';
  end if;

  repeat_result := public.prune_resend_delivery_evidence(1);
  if repeat_result <> '{"events_deleted": 0, "messages_deleted": 0}'::jsonb then
    raise exception 'Retention must be idempotent: %', repeat_result;
  end if;

  blocked := false;
  begin
    perform public.prune_resend_delivery_evidence(0);
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception 'Batch size 0 must fail closed';
  end if;

  blocked := false;
  begin
    perform public.prune_resend_delivery_evidence(1001);
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception 'Batch size above 1000 must fail closed';
  end if;

  blocked := false;
  begin
    perform public.prune_resend_delivery_evidence(null);
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception 'Null batch size must fail closed';
  end if;
end;
$retention_cases$;

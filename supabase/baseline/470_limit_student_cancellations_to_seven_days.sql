-- Reconstruct the current student cancellation boundary without activating
-- forecast RPCs that are not part of the schema-only recovery baseline.
-- The 12-hour replacement credit rule and teacher controls are unchanged.

create or replace function private.lesson_can_be_cancelled(
  target_starts_at timestamptz,
  evaluated_at timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select target_starts_at is not null
    and evaluated_at >= target_starts_at - interval '7 days'
    and evaluated_at < target_starts_at;
$function$;

revoke execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  to service_role;

revoke execute on function public.cancel_my_lesson_replacement(uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_my_makeup_class_booking(uuid)
  from public, anon, authenticated;

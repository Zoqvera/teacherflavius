-- A replacement is eligible whenever at least one operational seat remains.
-- Keep the existing signature to preserve the listing and booking RPC contracts.
create or replace function private.is_replacement_occurrence_eligible(
  available_spots integer,
  cancellation_spots_available integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select available_spots >= 1;
$function$;

comment on function private.is_replacement_occurrence_eligible(integer, integer) is
  'A replacement occurrence is eligible when at least one operational seat remains after regular enrollments, cancellations and confirmed replacements.';

revoke execute on function private.is_replacement_occurrence_eligible(integer, integer)
  from public, anon, authenticated;
grant execute on function private.is_replacement_occurrence_eligible(integer, integer)
  to service_role;

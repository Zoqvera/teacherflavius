-- Stage 1D.6: metadata-only inventory of reviewed, privileged privacy RPCs.
-- No application records, function definitions, JWTs, or secrets are exported.
-- Run with PostgreSQL read permissions; this query never writes to production.
select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef::text as security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE')::text as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')::text as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')::text as service_execute,
  coalesce(
    array_to_string(p.proconfig, ';'), ''
  ) like '%search_path=%' as has_explicit_search_path,
  position('aal2' in lower(pg_get_functiondef(p.oid))) > 0 as mentions_aal2,
  position('is_teacher_admin_mfa' in lower(pg_get_functiondef(p.oid))) > 0
    as references_admin_mfa_alias
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    p.proname ~ '(privacy|retention|subject|account_deletion|external_data_processor|student_account|data_export)'
    or p.proname = 'delete_teacher_student'
  )
order by p.oid::regprocedure::text;

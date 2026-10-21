-- ETAPA 1D.2: metadata-only policy posture comparison.
-- Do not export USING/WITH CHECK SQL, row contents, JWTs or database secrets.
select
  schemaname || '.' || tablename || '.' || policyname as object_id,
  cmd,
  permissive,
  array_to_string(array(select role from unnest(roles) role order by role), ',') as role_names,
  encode(sha256(convert_to(coalesce(qual, ''), 'UTF8')), 'hex') as using_hash,
  encode(sha256(convert_to(coalesce(with_check, ''), 'UTF8')), 'hex') as check_hash
from pg_catalog.pg_policies
where schemaname in ('public', 'private')
order by schemaname, tablename, policyname;

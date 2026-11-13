-- Read-only guard for semantically equivalent, immutable 20261113113321
-- migration variants. The enrollment offer must never assign Meta attribution.
WITH definitions AS (
  SELECT
    pg_get_functiondef('public.authorize_my_matricula50()'::regprocedure) AS auth_ddl,
    pg_get_functiondef('public.get_my_matricula80_payment_gate()'::regprocedure) AS gate_ddl
)
SELECT
  strpos(auth_ddl, 'public.authorize_my_enrollment_link(promotion.token)') > 0
  AND strpos(auth_ddl, 'private.save_student_acquisition') = 0
  AND strpos(auth_ddl, 'marketing_campaign_confirmed_students') = 0
  AND strpos(auth_ddl, 'anuncio50') = 0
  AND strpos(auth_ddl, 'promotion.monthly_fee') > 0
  AND strpos(auth_ddl, 'promotion.classes_per_month') > 0
  AND strpos(gate_ddl, 'invite.seed_key = ''matricula50''') > 0
  AND strpos(gate_ddl, 'access.monthly_fee = 50.00') > 0
  AND strpos(gate_ddl, 'acquisition.declared_source = ''anúncio80''') > 0
  AND NOT has_function_privilege('anon', 'public.authorize_my_matricula50()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.authorize_my_matricula50()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_my_matricula80_payment_gate()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_my_matricula80_payment_gate()', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.authorize_my_matricula50()'::regprocedure)
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_my_matricula80_payment_gate()'::regprocedure)
  AND (SELECT provolatile = 's' FROM pg_proc WHERE oid = 'public.get_my_matricula80_payment_gate()'::regprocedure)
  AS attested
FROM definitions;

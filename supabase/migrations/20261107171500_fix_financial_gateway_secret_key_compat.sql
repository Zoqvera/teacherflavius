-- Fix new Supabase opaque secret-key compatibility for server-only billing RPCs.
-- These SECURITY DEFINER functions already restrict EXECUTE to service_role.
-- Opaque sb_secret keys authenticate at the API gateway without populating
-- request.jwt.claim.role; the redundant JWT gate caused HTTP 403 and Pix HTTP 409.
-- Retain the existing business validations and all billing settlement logic.
DO $payment_gateway_hotfix$
DECLARE
  target_signature regprocedure;
  function_definition text;
  role_guard text;
  denial_message text;
  common_prefix constant text :=
    E'  if current_setting(''request.jwt.claim.role'', true) is distinct from ''service_role''\n'
    || E'     and session_user <> ''postgres'' then\n';
BEGIN
  FOR target_signature IN
    SELECT unnest(ARRAY[
      'public.get_financial_responsibility_payment_quote_internal(uuid,uuid)'::regprocedure,
      'public.reserve_financial_responsibility_payment(uuid,uuid)'::regprocedure,
      'public.process_financial_responsibility_payment(uuid,text,text,text,numeric,text,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
    ])
  LOOP
    denial_message := CASE
      WHEN target_signature::text LIKE '%get_financial_responsibility_payment_quote_internal%'
        THEN 'Acesso exclusivo do servidor.'
      ELSE 'Acesso exclusivo do serviço de pagamentos.'
    END;
    role_guard := common_prefix
      || format('    raise exception %L using errcode = ''42501'';', denial_message)
      || E'\n  end if;';

    SELECT pg_get_functiondef(target_signature) INTO function_definition;

    IF strpos(function_definition, role_guard) > 0 THEN
      EXECUTE replace(function_definition, role_guard,
        '  -- Server-only access is enforced by the function EXECUTE privilege.');
    ELSIF strpos(function_definition, 'request.jwt.claim.role') > 0 THEN
      RAISE EXCEPTION 'Unexpected access guard in %. Aborting hotfix.', target_signature;
    END IF;

    -- Explicit, role-based access is independent of legacy JWT claims.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', target_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target_signature);
  END LOOP;
END;
$payment_gateway_hotfix$;
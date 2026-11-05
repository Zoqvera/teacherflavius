-- Run in an isolated fixture after both payment-agent migrations.
begin;
insert into private.payment_agent_oauth_clients (client_id, enabled)
values ('approved-test-client', true), ('disabled-test-client', false);
set local role supabase_auth_admin;
do $$
declare result jsonb;
begin
  result := public.payment_agent_access_token_hook('{"claims":{"role":"authenticated","sub":"teacher","client_id":"approved-test-client"},"authentication_method":"oauth_provider/authorization_code"}'::jsonb);
  if result #>> '{claims,role}' is distinct from 'teacher_payment_agent' or result #>> '{claims,sub}' is distinct from 'teacher' then
    raise exception 'Approved OAuth client did not receive the restricted role';
  end if;
  result := public.payment_agent_access_token_hook('{"claims":{"role":"authenticated","sub":"teacher"},"authentication_method":"password"}'::jsonb);
  if result #>> '{claims,role}' is distinct from 'authenticated' then
    raise exception 'Ordinary session was altered';
  end if;
  result := public.payment_agent_access_token_hook('{"claims":{"role":"authenticated","client_id":"disabled-test-client"}}'::jsonb);
  if result #>> '{error,http_code}' is distinct from '403' then
    raise exception 'Disabled client was not rejected';
  end if;
  result := public.payment_agent_access_token_hook('{"claims":{"role":"authenticated","client_id":"unknown-client"}}'::jsonb);
  if result #>> '{error,http_code}' is distinct from '403' then
    raise exception 'Unknown client was not rejected';
  end if;
  result := public.payment_agent_access_token_hook('{"claims":{"role":"authenticated"},"authentication_method":"oauth_provider/authorization_code"}'::jsonb);
  if result #>> '{error,http_code}' is distinct from '403' then
    raise exception 'OAuth request without client ID was not rejected';
  end if;
  result := public.payment_agent_access_token_hook('{"claims":{"role":"authenticated","sub":"teacher","client_id":"approved-test-client"},"authentication_method":"token_refresh"}'::jsonb);
  if result #>> '{claims,role}' is distinct from 'teacher_payment_agent' then
    raise exception 'Approved OAuth refresh did not retain the restricted role';
  end if;
end;
$$;
rollback;

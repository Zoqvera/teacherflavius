-- Draft only: this function is not enabled as an Auth hook by this migration.
-- Enabling a global hook requires an inventory of existing OAuth clients and
-- isolated end-to-end tests, including token refresh.
begin;

create table private.payment_agent_oauth_clients (
  client_id text primary key check (length(client_id) between 1 and 255),
  enabled boolean not null default false
);
alter table private.payment_agent_oauth_clients enable row level security;
revoke all on private.payment_agent_oauth_clients from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on private.payment_agent_oauth_clients to supabase_auth_admin;
create policy payment_agent_clients_auth_hook_read
  on private.payment_agent_oauth_clients for select to supabase_auth_admin using (true);

create function public.payment_agent_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  v_client_id text := nullif(claims ->> 'client_id', '');
  method text := event ->> 'authentication_method';
begin
  if jsonb_typeof(claims) is distinct from 'object' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Invalid token request'));
  end if;

  if v_client_id is not null then
    if not exists (
      select 1 from private.payment_agent_oauth_clients c
      where c.client_id = v_client_id and c.enabled
    ) then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'OAuth client not approved'));
    end if;
    claims := jsonb_set(claims, '{role}', to_jsonb('teacher_payment_agent'::text));
  elsif method = 'oauth_provider/authorization_code' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'OAuth client missing'));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;
revoke all on function public.payment_agent_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.payment_agent_access_token_hook(jsonb) to supabase_auth_admin;

commit;

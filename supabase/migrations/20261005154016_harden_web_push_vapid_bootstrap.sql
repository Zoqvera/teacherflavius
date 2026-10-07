-- Serialize first-use VAPID initialization so concurrent students cannot rotate the key pair.

create or replace function public.configure_web_push_vapid_keys(
  target_public_key text,
  target_private_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_public_key text;
  existing_secret_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Acesso restrito à configuração de notificações.'
      using errcode = '42501';
  end if;

  target_public_key := btrim(coalesce(target_public_key, ''));
  target_private_key := btrim(coalesce(target_private_key, ''));

  if char_length(target_public_key) < 40
     or char_length(target_public_key) > 256
     or char_length(target_private_key) < 20
     or char_length(target_private_key) > 256 then
    raise exception 'Par VAPID inválido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('teacherflavius-web-push-vapid')
  );

  select configuration.vapid_public_key
  into existing_public_key
  from private.web_push_configuration configuration
  where configuration.singleton = true;

  select secret.id
  into existing_secret_id
  from vault.secrets secret
  where secret.name = 'teacherflavius_web_push_vapid_private_key'
  limit 1;

  if nullif(existing_public_key, '') is not null
     and existing_secret_id is not null then
    return false;
  end if;

  if (nullif(existing_public_key, '') is null) <> (existing_secret_id is null) then
    raise exception 'Configuração VAPID incompleta; restaure o par existente antes de continuar.';
  end if;

  insert into private.web_push_configuration (
    singleton,
    vapid_public_key,
    updated_at
  )
  values (
    true,
    target_public_key,
    now()
  )
  on conflict (singleton) do update
  set
    vapid_public_key = excluded.vapid_public_key,
    updated_at = now();

  perform vault.create_secret(
    target_private_key,
    'teacherflavius_web_push_vapid_private_key',
    'Private VAPID key for PWA Web Push delivery'
  );

  return true;
end;
$function$;

revoke all on function public.configure_web_push_vapid_keys(text, text)
  from public, anon, authenticated;
grant execute on function public.configure_web_push_vapid_keys(text, text)
  to service_role;

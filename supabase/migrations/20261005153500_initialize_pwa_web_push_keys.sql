-- Generate the cron credential inside Vault and bootstrap VAPID without committing secrets.

create table if not exists private.web_push_configuration (
  singleton boolean primary key default true check (singleton = true),
  vapid_public_key text,
  updated_at timestamptz not null default now(),
  constraint web_push_configuration_public_key_length
    check (vapid_public_key is null or char_length(vapid_public_key) between 40 and 256)
);

revoke all on table private.web_push_configuration from public, anon, authenticated;
grant select, insert, update on table private.web_push_configuration to service_role;

do $block$
declare
  generated_secret text;
begin
  if not exists (
    select 1
    from vault.secrets secret
    where secret.name = 'teacherflavius_web_push_cron_secret'
  ) then
    generated_secret := translate(
      rtrim(
        pg_catalog.encode(extensions.gen_random_bytes(48), 'base64'),
        '='
      ),
      '+/',
      '-_'
    );

    perform vault.create_secret(
      generated_secret,
      'teacherflavius_web_push_cron_secret',
      'HMAC secret for scheduled PWA Web Push dispatch'
    );
  end if;
end;
$block$;

create or replace function public.get_web_push_vapid_public_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  caller_role text := coalesce(auth.jwt() ->> 'role', '');
  public_key text;
begin
  if caller_id is null and caller_role <> 'service_role' then
    raise exception 'Faça login para consultar a configuração de notificações.'
      using errcode = '42501';
  end if;

  select configuration.vapid_public_key
  into public_key
  from private.web_push_configuration configuration
  where configuration.singleton = true;

  return public_key;
end;
$function$;

revoke all on function public.get_web_push_vapid_public_key()
  from public, anon;
grant execute on function public.get_web_push_vapid_public_key()
  to authenticated, service_role;

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

  select secret.id
  into existing_secret_id
  from vault.secrets secret
  where secret.name = 'teacherflavius_web_push_vapid_private_key'
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      target_private_key,
      'teacherflavius_web_push_vapid_private_key',
      'Private VAPID key for PWA Web Push delivery'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      target_private_key,
      'teacherflavius_web_push_vapid_private_key',
      'Private VAPID key for PWA Web Push delivery'
    );
  end if;

  return true;
end;
$function$;

revoke all on function public.configure_web_push_vapid_keys(text, text)
  from public, anon, authenticated;
grant execute on function public.configure_web_push_vapid_keys(text, text)
  to service_role;

-- Fix Google account linking for legacy enrollments after profile identity
-- uniqueness hardening. The source profile temporarily keeps its unique
-- values only in source_profile while the row releases them for the new
-- Google-authenticated profile inside the same transaction.

create or replace function public.confirm_or_migrate_student_google_link_internal(
  target_google_user_id uuid,
  target_legacy_user_id uuid,
  target_google_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_google_email text := lower(btrim(coalesce(target_google_email, '')));
  source_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  ref record;
  mode_value text;
begin
  if target_google_user_id is null or target_legacy_user_id is null or normalized_google_email = '' then
    raise exception 'Dados de vinculação inválidos.';
  end if;

  select p.* into source_profile
  from public.profiles p
  where p.id = target_legacy_user_id
    and p.enrolled = true
    and coalesce(p.archived, false) = false
  for update;

  if source_profile.id is null then
    raise exception 'Matrícula não encontrada ou inativa.';
  end if;

  if exists (select 1 from public.teacher_admins ta where ta.user_id = target_legacy_user_id) then
    raise exception 'Conta administrativa não pode ser migrada por este fluxo.';
  end if;

  if target_google_user_id = target_legacy_user_id then
    mode_value := 'automatic';

    insert into public.student_google_account_links (
      google_user_id, legacy_user_id, enrollment_email, google_email, link_mode, confirmed_at, updated_at
    ) values (
      target_google_user_id,
      target_legacy_user_id,
      lower(btrim(coalesce(source_profile.email, ''))),
      normalized_google_email,
      mode_value,
      now(),
      now()
    )
    on conflict (google_user_id) do update
    set enrollment_email = excluded.enrollment_email,
        google_email = excluded.google_email,
        link_mode = excluded.link_mode,
        confirmed_at = now(),
        updated_at = now();

    return jsonb_build_object('linked', true, 'mode', mode_value, 'legacy_user_id', target_legacy_user_id);
  end if;

  if not exists (
    select 1
    from public.student_google_email_aliases a
    where a.google_email = normalized_google_email
      and a.enrollment_email = lower(btrim(coalesce(source_profile.email, '')))
      and a.active = true
  ) then
    raise exception 'Este e-mail Google não possui alias autorizado para a matrícula encontrada.';
  end if;

  if exists (
    select 1 from public.student_google_account_links l
    where l.legacy_user_id = target_legacy_user_id
       or l.google_user_id = target_google_user_id
  ) then
    raise exception 'Esta matrícula ou conta Google já foi vinculada.';
  end if;

  select p.* into target_profile
  from public.profiles p
  where p.id = target_google_user_id
  for update;

  if target_profile.id is not null and target_profile.enrolled = true then
    raise exception 'A conta Google já possui outra matrícula ativa.';
  end if;

  delete from public.profiles
  where id = target_google_user_id
    and enrolled = false;

  -- email, CPF and enrollment_code are unique profile identity fields. Keep
  -- their original values in source_profile, release them on the legacy row,
  -- and then recreate the profile under the Google user id. Any later failure
  -- rolls the whole transaction back, including these temporary nulls.
  update public.profiles
  set enrollment_code = null,
      cpf = null,
      email = null
  where id = target_legacy_user_id;

  insert into public.profiles
  select (jsonb_populate_record(
    null::public.profiles,
    to_jsonb(source_profile) || jsonb_build_object('id', target_google_user_id)
  )).*;

  for ref in
    select ns.nspname as schema_name, cls.relname as table_name, att.attname as column_name
    from pg_constraint c
    join pg_class cls on cls.oid = c.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    join lateral unnest(c.conkey) with ordinality ck(attnum, ord) on true
    join pg_attribute att on att.attrelid = c.conrelid and att.attnum = ck.attnum
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and ns.nspname = 'public'
      and cls.relname <> 'profiles'
  loop
    execute format('update %I.%I set %I = $1 where %I = $2', ref.schema_name, ref.table_name, ref.column_name, ref.column_name)
      using target_google_user_id, target_legacy_user_id;
  end loop;

  for ref in
    select ns.nspname as schema_name, cls.relname as table_name, att.attname as column_name
    from pg_constraint c
    join pg_class cls on cls.oid = c.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    join lateral unnest(c.conkey) with ordinality ck(attnum, ord) on true
    join pg_attribute att on att.attrelid = c.conrelid and att.attnum = ck.attnum
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and ns.nspname = 'public'
      and cls.relname not in ('profiles', 'teacher_admins')
  loop
    execute format('update %I.%I set %I = $1 where %I = $2', ref.schema_name, ref.table_name, ref.column_name, ref.column_name)
      using target_google_user_id, target_legacy_user_id;
  end loop;

  delete from public.profiles where id = target_legacy_user_id;

  mode_value := 'alias';
  insert into public.student_google_account_links (
    google_user_id, legacy_user_id, enrollment_email, google_email, link_mode, confirmed_at, updated_at
  ) values (
    target_google_user_id,
    target_legacy_user_id,
    lower(btrim(coalesce(source_profile.email, ''))),
    normalized_google_email,
    mode_value,
    now(),
    now()
  );

  return jsonb_build_object('linked', true, 'mode', mode_value, 'legacy_user_id', target_legacy_user_id);
end;
$$;
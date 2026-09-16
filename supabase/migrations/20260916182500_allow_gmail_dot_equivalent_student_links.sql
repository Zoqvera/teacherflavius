-- Preserve an existing enrollment and all related history when a student
-- authenticates with the same Gmail mailbox written with different dots.
-- Gmail ignores dots in the local part; other providers keep exact matching.

create or replace function public.canonical_gmail_email(target_email text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when lower(split_part(btrim(target_email), '@', 2)) in ('gmail.com', 'googlemail.com')
      and split_part(btrim(target_email), '@', 1) <> ''
    then replace(lower(split_part(btrim(target_email), '@', 1)), '.', '') || '@gmail.com'
    else lower(btrim(target_email))
  end;
$$;

revoke all on function public.canonical_gmail_email(text) from public, anon, authenticated;
grant execute on function public.canonical_gmail_email(text) to service_role;

create or replace function public.get_student_google_link_candidate_internal(
  target_google_user_id uuid,
  target_google_email text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  normalized_google_email text := lower(btrim(coalesce(target_google_email, '')));
  matched_profile public.profiles%rowtype;
  matched_mode text;
  canonical_google_email text;
  canonical_match_id uuid;
  canonical_match_count integer := 0;
begin
  if target_google_user_id is null or normalized_google_email = '' then
    return jsonb_build_object('show_prompt', false, 'reason', 'invalid_user');
  end if;

  if exists (
    select 1 from public.student_google_account_links l
    where l.google_user_id = target_google_user_id
  ) then
    return jsonb_build_object('show_prompt', false, 'reason', 'already_confirmed');
  end if;

  select p.* into matched_profile
  from public.profiles p
  where p.id = target_google_user_id
    and p.enrolled = true
    and coalesce(p.archived, false) = false
    and not exists (select 1 from public.teacher_admins ta where ta.user_id = p.id)
  limit 1;

  if found then
    matched_mode := 'automatic';
  else
    select p.* into matched_profile
    from public.student_google_email_aliases a
    join public.profiles p on lower(btrim(coalesce(p.email, ''))) = a.enrollment_email
    where a.google_email = normalized_google_email
      and a.active = true
      and p.enrolled = true
      and coalesce(p.archived, false) = false
      and not exists (select 1 from public.teacher_admins ta where ta.user_id = p.id)
      and not exists (
        select 1 from public.student_google_account_links l
        where l.legacy_user_id = p.id
      )
    limit 1;

    if found then
      matched_mode := 'alias';
    end if;
  end if;

  if matched_profile.id is null
     and lower(split_part(normalized_google_email, '@', 2)) in ('gmail.com', 'googlemail.com') then
    canonical_google_email := public.canonical_gmail_email(normalized_google_email);

    select count(*)::integer, min(p.id::text)::uuid
      into canonical_match_count, canonical_match_id
    from public.profiles p
    where p.id <> target_google_user_id
      and p.enrolled = true
      and coalesce(p.archived, false) = false
      and lower(split_part(btrim(coalesce(p.email, '')), '@', 2)) in ('gmail.com', 'googlemail.com')
      and public.canonical_gmail_email(p.email) = canonical_google_email
      and not exists (select 1 from public.teacher_admins ta where ta.user_id = p.id)
      and not exists (
        select 1 from public.student_google_account_links l
        where l.legacy_user_id = p.id
      );

    if canonical_match_count > 1 then
      return jsonb_build_object('show_prompt', false, 'reason', 'ambiguous_gmail_match');
    elsif canonical_match_count = 1 then
      select p.* into matched_profile
      from public.profiles p
      where p.id = canonical_match_id;
      matched_mode := 'alias';
    end if;
  end if;

  if matched_profile.id is null then
    return jsonb_build_object('show_prompt', false, 'reason', 'no_match');
  end if;

  return jsonb_build_object(
    'show_prompt', true,
    'mode', matched_mode,
    'legacy_user_id', matched_profile.id,
    'enrollment_email', lower(btrim(coalesce(matched_profile.email, ''))),
    'student_name', coalesce(matched_profile.name, '')
  );
end;
$$;

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
  normalized_enrollment_email text;
  source_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
  ref record;
  mode_value text;
  gmail_equivalent boolean := false;
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

  normalized_enrollment_email := lower(btrim(coalesce(source_profile.email, '')));

  if target_google_user_id = target_legacy_user_id then
    mode_value := 'automatic';

    insert into public.student_google_account_links (
      google_user_id, legacy_user_id, enrollment_email, google_email, link_mode, confirmed_at, updated_at
    ) values (
      target_google_user_id,
      target_legacy_user_id,
      normalized_enrollment_email,
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

  gmail_equivalent :=
    lower(split_part(normalized_google_email, '@', 2)) in ('gmail.com', 'googlemail.com')
    and lower(split_part(normalized_enrollment_email, '@', 2)) in ('gmail.com', 'googlemail.com')
    and public.canonical_gmail_email(normalized_google_email) = public.canonical_gmail_email(normalized_enrollment_email);

  if not exists (
    select 1
    from public.student_google_email_aliases a
    where a.google_email = normalized_google_email
      and a.enrollment_email = normalized_enrollment_email
      and a.active = true
  ) then
    if not gmail_equivalent then
      raise exception 'Este e-mail Google não possui alias autorizado para a matrícula encontrada.';
    end if;

    insert into public.student_google_email_aliases (
      google_email, enrollment_email, active, note
    ) values (
      normalized_google_email,
      normalized_enrollment_email,
      true,
      'Alias reconhecido automaticamente por equivalência de pontos do Gmail.'
    )
    on conflict (google_email) do nothing;

    if not exists (
      select 1
      from public.student_google_email_aliases a
      where a.google_email = normalized_google_email
        and a.enrollment_email = normalized_enrollment_email
        and a.active = true
    ) then
      raise exception 'O e-mail Google já está associado a outra matrícula.';
    end if;
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
    normalized_enrollment_email,
    normalized_google_email,
    mode_value,
    now(),
    now()
  );

  return jsonb_build_object('linked', true, 'mode', mode_value, 'legacy_user_id', target_legacy_user_id);
end;
$$;
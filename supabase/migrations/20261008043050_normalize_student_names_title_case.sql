-- Normalize only person-name fields; identity, enrollment, and payment fields stay unchanged.
create or replace function private.normalize_student_name(input_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when input_name is null then null
    else initcap(lower(regexp_replace(btrim(input_name), '[[:space:]]+', ' ', 'g')))
  end;
$$;

create or replace function private.normalize_student_name_before_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_argv[0] = 'name' then
    new.name := private.normalize_student_name(new.name);
  elsif tg_argv[0] = 'student_name' then
    new.student_name := private.normalize_student_name(new.student_name);
  else
    raise exception 'Unsupported student-name column: %', tg_argv[0];
  end if;
  return new;
end;
$$;

create or replace function private.normalize_auth_student_name_before_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  key_name text;
begin
  if new.raw_user_meta_data is null then
    return new;
  end if;

  foreach key_name in array array['name', 'full_name'] loop
    if jsonb_typeof(new.raw_user_meta_data -> key_name) = 'string' then
      new.raw_user_meta_data := jsonb_set(
        new.raw_user_meta_data,
        array[key_name],
        to_jsonb(private.normalize_student_name(new.raw_user_meta_data ->> key_name)),
        true
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists normalize_student_profile_name_before_write on public.profiles;
create trigger normalize_student_profile_name_before_write
before insert or update of name on public.profiles
for each row execute function private.normalize_student_name_before_write('name');

drop trigger if exists normalize_student_enrollment_name_before_write on public.student_enrollments;
create trigger normalize_student_enrollment_name_before_write
before insert or update of name on public.student_enrollments
for each row execute function private.normalize_student_name_before_write('name');

drop trigger if exists normalize_student_invite_name_before_write on public.student_enrollment_invites;
create trigger normalize_student_invite_name_before_write
before insert or update of student_name on public.student_enrollment_invites
for each row execute function private.normalize_student_name_before_write('student_name');

drop trigger if exists normalize_makeup_student_name_before_write on public.makeup_class_bookings;
create trigger normalize_makeup_student_name_before_write
before insert or update of student_name on public.makeup_class_bookings
for each row execute function private.normalize_student_name_before_write('student_name');

drop trigger if exists normalize_exercise_student_name_before_write on public.exercise_sync_events;
create trigger normalize_exercise_student_name_before_write
before insert or update of student_name on public.exercise_sync_events
for each row execute function private.normalize_student_name_before_write('student_name');

drop trigger if exists normalize_auth_student_names_before_write on auth.users;
create trigger normalize_auth_student_names_before_write
before insert or update of raw_user_meta_data on auth.users
for each row execute function private.normalize_auth_student_name_before_write();

-- Backfill existing student-facing names in current operational tables.
update public.profiles
set name = private.normalize_student_name(name)
where name is distinct from private.normalize_student_name(name);

update public.student_enrollments
set name = private.normalize_student_name(name)
where name is distinct from private.normalize_student_name(name);

update public.student_enrollment_invites
set student_name = private.normalize_student_name(student_name)
where student_name is distinct from private.normalize_student_name(student_name);

update public.makeup_class_bookings
set student_name = private.normalize_student_name(student_name)
where student_name is distinct from private.normalize_student_name(student_name);

update public.exercise_sync_events
set student_name = private.normalize_student_name(student_name)
where student_name is distinct from private.normalize_student_name(student_name);

-- Auth metadata is also a fallback source of student names.
update auth.users
set raw_user_meta_data = raw_user_meta_data
where (raw_user_meta_data ->> 'name') is distinct from
        private.normalize_student_name(raw_user_meta_data ->> 'name')
   or (raw_user_meta_data ->> 'full_name') is distinct from
        private.normalize_student_name(raw_user_meta_data ->> 'full_name');

revoke all on function private.normalize_student_name(text) from public, anon, authenticated;
revoke all on function private.normalize_student_name_before_write() from public, anon, authenticated;
revoke all on function private.normalize_auth_student_name_before_write() from public, anon, authenticated;
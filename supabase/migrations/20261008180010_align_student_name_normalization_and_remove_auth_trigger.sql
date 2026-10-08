-- Keep student-name normalization deterministic across browser and database.
-- Auth metadata is normalized by the enrollment client; the database trigger is
-- intentionally limited to student operational tables.

create or replace function private.normalize_student_name(input_name text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $function$
declare
  normalized text;
  result text := '';
  current_char text;
  capitalize_next boolean := true;
  position_index integer;
begin
  if input_name is null then
    return null;
  end if;

  normalized := lower(regexp_replace(btrim(input_name), '[[:space:]]+', ' ', 'g'));

  for position_index in 1..char_length(normalized) loop
    current_char := substr(normalized, position_index, 1);

    if current_char ~ '[[:alpha:]]' then
      result := result || case
        when capitalize_next then upper(current_char)
        else current_char
      end;
      capitalize_next := false;
    elsif current_char ~ '[[:digit:]]' then
      result := result || current_char;
      capitalize_next := false;
    else
      result := result || current_char;
      capitalize_next := true;
    end if;
  end loop;

  return result;
end;
$function$;

drop trigger if exists normalize_auth_student_names_before_write on auth.users;
drop function if exists private.normalize_auth_student_name_before_write();

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

revoke all on function private.normalize_student_name(text)
  from public, anon, authenticated;

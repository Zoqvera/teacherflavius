-- Keep protected administrative profile fields immutable without blocking
-- legitimate student profile updates (including INSERT ... ON CONFLICT DO UPDATE).
-- Applied to production as Supabase migration 20260825221034.

create or replace function public.protect_profile_security_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  requester_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if current_user = 'authenticated'
     and auth.uid() is not null
     and not coalesce(public.is_teacher_admin(), false)
  then
    if tg_op = 'INSERT' then
      new.email := requester_email;
      new.created_at := now();
      new.enrollment_code := null;
      new.enrolled := false;
      new.exercise_schedule_start_date := null;
      new.archived := false;
      new.archived_at := null;
      new.class_type := null;
      new.first_portal_access_at := null;
      new.last_portal_access_at := null;
    elsif tg_op = 'UPDATE' then
      if coalesce(old.archived, false) = true then
        raise exception 'Esta conta foi encerrada e não pode ser reativada pelo portal.' using errcode = '42501';
      end if;

      -- Student-facing updates may arrive through INSERT ... ON CONFLICT DO UPDATE.
      -- Preserve all administrative columns instead of rejecting the whole update.
      -- This keeps the security boundary intact while allowing editable profile fields.
      new.email := old.email;
      new.created_at := old.created_at;
      new.enrollment_code := old.enrollment_code;
      new.enrolled := old.enrolled;
      new.exercise_schedule_start_date := old.exercise_schedule_start_date;
      new.archived := old.archived;
      new.archived_at := old.archived_at;
      new.class_type := old.class_type;
      new.first_portal_access_at := old.first_portal_access_at;
      new.last_portal_access_at := old.last_portal_access_at;
    end if;
  end if;

  return new;
end;
$$;

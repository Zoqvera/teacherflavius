-- Keep Google onboarding activation compatible with the strict profiles INSERT RLS policy.
-- BEFORE INSERT must leave protected enrollment fields in their safe draft state;
-- activation is performed on UPDATE or, for a true first insert, immediately AFTER INSERT.

create or replace function public.activate_completed_google_student_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  provider_name text;
  candidate_code text;
begin
  -- The INSERT policy intentionally only accepts a non-enrolled draft profile.
  -- Do not transform that row before RLS WITH CHECK is evaluated.
  if tg_op = 'INSERT' then
    return new;
  end if;

  select u.raw_app_meta_data ->> 'provider'
    into provider_name
  from auth.users u
  where u.id = new.id;

  if coalesce(new.profile_completed, false) = true
     and coalesce(new.enrolled, false) = false
     and provider_name = 'google'
     and not exists (
       select 1
       from public.teacher_admins ta
       where ta.user_id = new.id
          or lower(ta.email) = lower(coalesce(new.email, ''))
     ) then
    new.enrolled := true;

    if nullif(btrim(new.enrollment_code), '') is null then
      loop
        candidate_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 5));
        exit when not exists (
          select 1
          from public.profiles p
          where p.enrollment_code = candidate_code
            and p.id <> new.id
        );
      end loop;
      new.enrollment_code := candidate_code;
    end if;

    -- The generic schedule trigger runs before this activation trigger, so set
    -- the enrollment start date here when activation occurs at the end of the
    -- BEFORE UPDATE trigger chain.
    if new.exercise_schedule_start_date is null then
      new.exercise_schedule_start_date := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.activate_completed_google_student_profile_after_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if coalesce(new.profile_completed, false) = true
     and coalesce(new.enrolled, false) = false
     and exists (
       select 1
       from auth.users u
       where u.id = new.id
         and u.raw_app_meta_data ->> 'provider' = 'google'
     )
     and not exists (
       select 1
       from public.teacher_admins ta
       where ta.user_id = new.id
          or lower(ta.email) = lower(coalesce(new.email, ''))
     ) then
    -- Rewriting profile_completed invokes the normal BEFORE UPDATE activation
    -- path after the safe draft row has already passed INSERT RLS.
    update public.profiles p
       set profile_completed = p.profile_completed
     where p.id = new.id
       and coalesce(p.enrolled, false) = false;
  end if;

  return new;
end;
$function$;

drop trigger if exists zzz_activate_completed_google_student_profile_after_insert on public.profiles;
create trigger zzz_activate_completed_google_student_profile_after_insert
after insert on public.profiles
for each row
when (new.profile_completed is true)
execute function public.activate_completed_google_student_profile_after_insert();

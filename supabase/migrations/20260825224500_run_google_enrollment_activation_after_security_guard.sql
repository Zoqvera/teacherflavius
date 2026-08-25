-- Ensure completed Google onboarding is activated after the profile security guard.
-- PostgreSQL executes triggers with the same timing/event in name order. The old
-- activation trigger ran before protect_profile_security_fields_trigger, so the
-- security guard restored enrolled/enrollment_code to their previous values.

drop trigger if exists activate_completed_google_student_profile_before_write on public.profiles;
drop trigger if exists zz_activate_completed_google_student_profile_before_write on public.profiles;

create trigger zz_activate_completed_google_student_profile_before_write
before insert or update of profile_completed, enrolled, enrollment_code, email on public.profiles
for each row
execute function public.activate_completed_google_student_profile();

-- Repair completed Google student profiles affected by the trigger-order bug.
-- Rewriting profile_completed invokes the corrected trigger sequence without hardcoded IDs.
update public.profiles p
set profile_completed = p.profile_completed
where coalesce(p.profile_completed, false) = true
  and coalesce(p.enrolled, false) = false
  and exists (
    select 1
    from auth.users u
    where u.id = p.id
      and u.raw_app_meta_data ->> 'provider' = 'google'
  )
  and not exists (
    select 1
    from public.teacher_admins ta
    where ta.user_id = p.id
       or lower(ta.email) = lower(coalesce(p.email, ''))
  );

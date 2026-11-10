-- A BEFORE UPDATE hook may set enrolled=true even when the UPDATE
-- statement targets only profile_completed. UPDATE OF enrolled misses it.
-- Inspect the actual OLD/NEW transition for every profile update instead.
drop trigger if exists ensure_first_tuition_after_profile_enrollment
  on public.profiles;

create trigger ensure_first_tuition_after_profile_enrollment
after update on public.profiles
for each row
when (
  old.enrolled is distinct from new.enrolled
  and new.enrolled is true
)
execute function private.ensure_first_tuition_after_profile_enrollment();
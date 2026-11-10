-- The enrollment activation BEFORE UPDATE hook sets enrolled = true when
-- the original UPDATE targets profile_completed. Column-specific triggers
-- cannot detect that implicit transition.
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

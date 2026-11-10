-- Emergency-only rollback if an old browser client fails to update a profile.
-- Restore only the three legacy columns; do NOT restore broad UPDATE permissions.
grant update (enrolled, enrollment_code, class_type)
on table public.profiles to authenticated;

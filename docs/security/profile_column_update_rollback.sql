-- Emergency-only rollback: restore the previous table-level UPDATE permission.
-- Existing RLS policies and profile safety triggers remain in force.
grant update on table public.profiles to authenticated;

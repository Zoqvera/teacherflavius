revoke all on table public.teacher_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.teacher_admins to service_role;

drop policy if exists "Professor pode verificar suas próprias credenciais" on public.teacher_admins;

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create or replace function public.is_teacher_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_admins ta
    where ta.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_teacher_admin() from public, anon;
grant execute on function public.is_teacher_admin() to authenticated, service_role;

create or replace function public.is_teacher_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then true
    else coalesce(public.is_teacher_admin(), false)
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  end;
$$;

revoke all on function public.is_teacher_admin_mfa() from public, anon;
grant execute on function public.is_teacher_admin_mfa() to authenticated, service_role;

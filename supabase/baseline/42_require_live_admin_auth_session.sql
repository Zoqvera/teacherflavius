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
      and exists (
        select 1
        from auth.sessions s
        where s.id::text = coalesce(auth.jwt() ->> 'session_id', '')
          and s.user_id = (select auth.uid())
          and s.aal::text = 'aal2'
          and (s.not_after is null or s.not_after > now())
      )
  end;
$$;

revoke all on function public.is_teacher_admin_mfa() from public, anon;
grant execute on function public.is_teacher_admin_mfa() to authenticated, service_role;

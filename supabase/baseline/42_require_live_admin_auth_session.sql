create or replace function public.is_teacher_admin_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then true
    else coalesce(public.is_teacher_admin(), false)
  end;
$function$;

comment on function public.is_teacher_admin_mfa()
is 'Backward-compatible administrative authorization alias. MFA/AAL2 is no longer required for professor/admin operations.';

revoke all on function public.is_teacher_admin_mfa() from public, anon;
grant execute on function public.is_teacher_admin_mfa() to authenticated, service_role;

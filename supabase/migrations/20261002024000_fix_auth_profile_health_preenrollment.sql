-- Login with Google happens before enrollment completion. An Auth account without a
-- profile is therefore expected until enrollment has been authorized/completed.
-- Restrict the health warning to accounts that should already have a profile.

do $migration$
declare
  current_definition text;
  updated_definition text;
  old_fragment text := $old$
  select count(*)::integer into auth_users_without_profile_older_1h
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.deleted_at is null
    and u.created_at < now() - interval '1 hour'
    and p.id is null;
$old$;
  new_fragment text := $new$
  select count(*)::integer into auth_users_without_profile_older_1h
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.deleted_at is null
    and p.id is null
    and (
      exists (
        select 1
        from private.student_enrollment_access access
        where access.user_id = u.id
          and access.authorized_at is not null
          and access.authorized_at < now() - interval '1 hour'
      )
      or exists (
        select 1
        from public.student_enrollment_invites invite
        where invite.status = 'completed'
          and (
            invite.user_id = u.id
            or (
              invite.user_id is null
              and coalesce(u.email, '') <> ''
              and lower(coalesce(invite.email, '')) = lower(u.email)
            )
          )
          and coalesce(invite.completed_at, invite.created_at) < now() - interval '1 hour'
      )
    );
$new$;
begin
  select pg_get_functiondef(
    'private.run_auth_account_health_check(boolean)'::regprocedure
  )
  into current_definition;

  if current_definition is null then
    raise exception 'Auth account health function not found.';
  end if;

  updated_definition := replace(current_definition, old_fragment, new_fragment);

  if updated_definition = current_definition then
    raise exception 'Expected auth-user-without-profile query was not found.';
  end if;

  execute updated_definition;
end
$migration$;

select private.run_auth_account_health_check(false);

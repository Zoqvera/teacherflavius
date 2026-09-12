delete from public.teacher_admins ta
where ta.user_id is null
  and not exists (
    select 1
    from auth.users u
    where u.deleted_at is null
      and lower(coalesce(u.email, '')) = lower(coalesce(ta.email, ''))
  )
  and not exists (
    select 1
    from public.profiles p
    where lower(coalesce(p.email, '')) = lower(coalesce(ta.email, ''))
  )
  and not exists (
    select 1
    from public.student_enrollment_invites i
    where lower(coalesce(i.email, '')) = lower(coalesce(ta.email, ''))
  );

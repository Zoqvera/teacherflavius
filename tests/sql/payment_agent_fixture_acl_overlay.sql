-- Disposable fixture only. Align seven reconstructed function ACLs with the
-- observed production ACLs (2026-11-04); never apply to a real database.
begin;
do $$
begin
  if (select count(*) from public.teacher_classes where class_number in (970001, 970002)) <> 2
    or exists (select 1 from public.profiles)
    or exists (select 1 from public.monthly_tuition)
    or exists (select 1 from cron.job where active) then
    raise exception 'Refusing fixture ACL overlay on a non-disposable database';
  end if;
end;
$$;

revoke execute on function public.create_teacher_class_with_type__mfa_inner(text,text) from public, anon, authenticated;
revoke execute on function public.generate_monthly_tuition__mfa_inner(date) from public, anon, authenticated;
revoke execute on function public.get_group_classes_with_available_spots__mfa_inner() from public, anon, authenticated;
revoke execute on function public.set_teacher_class_type__mfa_inner(integer,text) from public, anon, authenticated;
revoke execute on function public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer) from public, anon;
revoke execute on function public.get_teacher_trial_lesson_classes() from public, anon;
revoke execute on function public.update_teacher_trial_lesson(uuid,text,text,text,text,date,time without time zone,integer) from public, anon;
grant execute on function public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer) to authenticated;
grant execute on function public.get_teacher_trial_lesson_classes() to authenticated;
grant execute on function public.update_teacher_trial_lesson(uuid,text,text,text,text,date,time without time zone,integer) to authenticated;
commit;

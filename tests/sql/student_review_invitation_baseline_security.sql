-- Security smoke test for the review invitation recovery overlay.
-- Intended for a disposable Supabase restoration, not production data.
do $invitation_security$
begin
  if to_regclass('private.student_review_invitation_metrics') is null then
    raise exception 'Private review invitation metrics were not restored.';
  end if;

  if not exists (
    select 1 from pg_class c
    where c.oid = 'private.student_review_invitation_metrics'::regclass
      and c.relrowsecurity
  ) then
    raise exception 'Invitation metrics must have RLS enabled.';
  end if;

  if has_table_privilege('authenticated',
                         'private.student_review_invitation_metrics', 'SELECT')
    or has_table_privilege('anon',
                           'private.student_review_invitation_metrics', 'SELECT') then
    raise exception 'Invitation metrics cannot be queried directly by browsers.';
  end if;

  if has_function_privilege(
      'anon', 'public.record_my_student_review_invitation(text)', 'EXECUTE'
    ) or has_function_privilege(
      'anon', 'public.get_teacher_student_review_invitation_metrics()', 'EXECUTE'
    ) then
    raise exception 'Anonymous users cannot call invitation metrics RPCs.';
  end if;

  if not has_function_privilege(
      'authenticated', 'public.record_my_student_review_invitation(text)', 'EXECUTE'
    ) or not has_function_privilege(
      'authenticated', 'public.get_teacher_student_review_invitation_metrics()', 'EXECUTE'
    ) then
    raise exception 'Authenticated RPC grants are missing.';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.record_my_student_review_invitation(text)'::regprocedure
      and prosecdef = true
      and prosrc like '%auth.uid()%'
      and prosrc like '%student_class_reviews%'
  ) then
    raise exception 'Invitation event writer is missing its authentication checks.';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.get_teacher_student_review_invitation_metrics()'::regprocedure
      and prosecdef = true
      and prosrc like '%is_teacher_admin()%'
  ) then
    raise exception 'Invitation report is missing the teacher privilege guard.';
  end if;
end;
$invitation_security$;

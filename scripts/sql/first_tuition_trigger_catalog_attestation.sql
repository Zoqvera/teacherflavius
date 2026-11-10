-- Attest the live fix without rewriting an immutable migration or its ledger.
select
  exists (
    select 1
    from pg_trigger trig
    where trig.tgrelid = 'public.profiles'::regclass
      and trig.tgname = 'ensure_first_tuition_after_profile_enrollment'
      and trig.tgenabled = 'O'
      and trig.tgfoid = 'private.ensure_first_tuition_after_profile_enrollment()'::regprocedure
      and pg_get_triggerdef(trig.oid, true) ~* 'AFTER UPDATE ON (public[.])?profiles FOR EACH ROW'
      and pg_get_triggerdef(trig.oid, true) ilike '%old.enrolled IS DISTINCT FROM new.enrolled%'
      and pg_get_triggerdef(trig.oid, true) ilike '%new.enrolled IS TRUE%'
      and pg_get_triggerdef(trig.oid, true) not ilike '%UPDATE OF enrolled%'
  )
  and exists (
    select 1
    from pg_proc proc
    where proc.oid = 'private.ensure_first_tuition_after_profile_enrollment()'::regprocedure
      and pg_get_functiondef(proc.oid) ilike '%perform private.ensure_first_tuition_for_student(%'
      and pg_get_functiondef(proc.oid) ilike '%new.tuition_first_due_date is not null%'
  ) as attested;

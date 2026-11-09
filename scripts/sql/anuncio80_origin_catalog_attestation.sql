-- Independent, read-only verification for the immutable announcement-origin migration.
select (
  private.canonical_acquisition_source('Anuncio80', null) = 'anúncio80'
  and private.canonical_acquisition_source('instagram', null) = 'instagram'
  and private.canonical_acquisition_source('other', 'TikTok') = 'other'
  and not has_function_privilege(
    'anon', 'private.canonical_acquisition_source(text,text)', 'EXECUTE'
  )
  and (
    select count(*) = 3
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'private'
      and (t.relname, c.conname) in (
        ('student_acquisition', 'student_origin_allowed'),
        ('promotion_reservations', 'promotion_origin_allowed'),
        ('trial_lesson_appointments', 'trial_origin_allowed')
      )
      and pg_get_constraintdef(c.oid) like '%anúncio80%'
  )
  and (
    select count(*) = 2
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('canonical_acquisition_source', 'validate_acquisition_origin')
      and p.prosecdef = false
  )
) as attested;

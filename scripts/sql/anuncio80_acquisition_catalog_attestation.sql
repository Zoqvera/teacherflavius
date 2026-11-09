-- Read-only verification of the already deployed anúncio80 attribution contract.
-- No migrations, student records, or access policies are changed.
select (
  private.canonical_acquisition_source('Anuncio80', null) = 'anúncio80'
  and private.canonical_acquisition_source('anúncio80', null) = 'anúncio80'
  and private.canonical_acquisition_source('instagram', null) = 'instagram'
  and private.canonical_acquisition_source('other', 'TikTok') = 'other'
  and (
    select count(*) = 3
    from pg_constraint
    where (conrelid, conname) in (
      ('private.student_acquisition'::regclass, 'student_origin_allowed'),
      ('private.promotion_reservations'::regclass, 'promotion_origin_allowed'),
      ('private.trial_lesson_appointments'::regclass, 'trial_origin_allowed')
    )
      and pg_get_constraintdef(oid) like '%anúncio80%'
  )
  and (
    select count(*) = 1
    from supabase_migrations.schema_migrations
    where version = '20261109155035'
      and name = 'add_anuncio80_acquisition_origin'
  )
);

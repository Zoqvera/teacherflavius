-- Immutable, read-only verification of the deployed teacher-planned lesson fix.
-- This attestation does not replay SQL or change the migration ledger.
select coalesce(
  encode(
    extensions.digest(
      pg_get_functiondef(
        to_regprocedure('private.academic_next_lesson_number(uuid)')
      ),
      'sha256'
    ),
    'hex'
  ) = '7d4d6e90bc3a235507e04327ca1bcce88acf336b7b2cc05d995c8402427229c3'
  and not has_function_privilege(
    'anon',
    'private.academic_next_lesson_number(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.academic_next_lesson_number(uuid)',
    'EXECUTE'
  ),
  false
) as attested;

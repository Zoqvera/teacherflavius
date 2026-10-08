-- RETIRED MANUAL SQL: supabase_limite_excepcional_turma_9_mon_21h.sql
-- Inactive entry point. Use a reviewed Supabase migration for current class rules.
DO $retired$
BEGIN
  RAISE EXCEPTION 'Script manual desativado: utilize as migracoes Supabase atuais.'
    USING ERRCODE = '0A000';
END;
$retired$;

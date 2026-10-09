-- Prevent the creation of new tuition charges for archived students.
-- Existing tuition records and payment reconciliation remain untouched.
CREATE OR REPLACE FUNCTION private.reject_new_tuition_for_archived_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  archived_student boolean;
BEGIN
  SELECT COALESCE(profile.archived, false)
    INTO archived_student
  FROM public.profiles AS profile
  WHERE profile.id = NEW.student_id
  FOR SHARE;

  IF COALESCE(archived_student, false) THEN
    RAISE EXCEPTION
      'Não é permitido gerar novas mensalidades para um aluno arquivado.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.reject_new_tuition_for_archived_student()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS monthly_tuition_prevent_archived_new_charge
ON public.monthly_tuition;

CREATE TRIGGER monthly_tuition_prevent_archived_new_charge
BEFORE INSERT OR UPDATE OF student_id ON public.monthly_tuition
FOR EACH ROW
EXECUTE FUNCTION private.reject_new_tuition_for_archived_student();
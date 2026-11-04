-- Permanently discontinue email notifications for the retired class-seat waitlist.
-- Preserve historical notifications and unrelated email workflows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'class-waitlist-vacancy-email-every-minute'
  ) THEN
    PERFORM cron.unschedule('class-waitlist-vacancy-email-every-minute');
  END IF;
END;
$$;

-- These two RPCs belonged exclusively to the retired email worker.
-- Revoke the worker's permission to claim or finalize even old notifications.
REVOKE EXECUTE ON FUNCTION public.claim_class_waitlist_vacancy_emails_internal(integer)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.finish_class_waitlist_vacancy_email_internal(uuid,text,text,text)
  FROM service_role;

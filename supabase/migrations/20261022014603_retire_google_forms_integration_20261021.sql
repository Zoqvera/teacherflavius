-- Retire Google Forms writes while preserving all exercise completion and sync history.
-- Google Apps Script triggers live outside Supabase and must be removed separately.
revoke execute on function public.upsert_google_form_integration(text, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.retry_google_form_integration(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.disconnect_google_form_integration(uuid) from public, anon, authenticated, service_role;

-- Logical disconnection only: no claim that external Google triggers were removed.
update public.exercise_form_sources
set status = 'disconnected',
    last_error = null,
    updated_at = now()
where status <> 'disconnected';

-- Least-privilege hardening for browser-facing Postgres roles.
-- Existing Data API access is aligned with current RLS policies.

-- Browser roles do not need schema-level destructive/DDL-adjacent table capabilities.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Anonymous users only need the explicitly public CMS override table directly.
revoke all on all tables in schema public from anon;
grant select on table public.page_content_overrides to anon;

-- Align authenticated CRUD grants to operations that actually have an RLS policy.
revoke delete, update on table public.activity_results from authenticated;
revoke delete, insert, update on table public.class_students from authenticated;
revoke delete, insert, update on table public.daily_exercise_completion from authenticated;
revoke delete on table public.grammar_lesson_completion from authenticated;
revoke delete, insert on table public.pronunciation_attempts from authenticated;
revoke delete, insert, update on table public.student_enrollments from authenticated;
revoke delete, insert, update on table public.student_frequency from authenticated;
revoke delete on table public.student_private_data from authenticated;
revoke update on table public.student_tags from authenticated;

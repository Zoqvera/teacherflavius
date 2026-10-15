-- Synthetic test data for a disposable Supabase database only.
-- This file is disabled in the repository's config.toml. It is deliberately
-- fail-closed if production records or active scheduled jobs exist.
-- Never copy profiles, payments, contacts, or secrets from the live project.
do $synthetic_preview_seed$
begin
  if to_regclass('public.teacher_classes') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.monthly_tuition') is null
     or to_regclass('cron.job') is null then
    raise exception 'A complete isolated schema is required before seeding';
  end if;

  if exists (select 1 from public.teacher_classes)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.monthly_tuition) then
    raise exception 'Synthetic seed requires an empty application database';
  end if;

  if exists (select 1 from cron.job where active) then
    raise exception 'Disable all scheduled jobs before applying synthetic data';
  end if;

  insert into public.teacher_classes (
    class_number,
    class_name,
    class_type,
    class_weekday,
    class_start_time,
    is_active,
    makeup_slots_enabled
  )
  values
    (970001, 'Synthetic preview quintet', 'quintet', 5, '18:00', true, false),
    (970002, 'Synthetic preview individual', 'individual', 3, '10:00', true, false);
end;
$synthetic_preview_seed$;

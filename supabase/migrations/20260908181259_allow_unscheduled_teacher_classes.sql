alter table public.teacher_classes
  drop constraint if exists teacher_classes_schedule_pair_check;

alter table public.teacher_classes
  add constraint teacher_classes_schedule_pair_check
  check (
    (class_weekday is null and class_start_time is null)
    or
    (class_weekday is not null and class_start_time is not null)
  );

update public.teacher_classes
set
  class_weekday = null,
  class_start_time = null,
  updated_at = now()
where is_active = true
  and lower(trim(class_name)) = 'indeterminada';

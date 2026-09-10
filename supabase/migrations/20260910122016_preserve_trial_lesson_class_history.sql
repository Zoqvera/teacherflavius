alter table private.trial_lesson_appointments
  drop constraint trial_lesson_class_mode_check;

alter table private.trial_lesson_appointments
  add constraint trial_lesson_class_mode_check check (
    (lesson_mode = 'class' and class_name_snapshot is not null)
    or (lesson_mode = 'individual' and class_number is null and class_name_snapshot is null)
  );

-- A student can have only one tuition due on any calendar date.
-- This is a hard database invariant so different reference months can never
-- share the same due date for the same student.

alter table public.monthly_tuition
  add constraint monthly_tuition_student_id_due_date_key
  unique (student_id, due_date);

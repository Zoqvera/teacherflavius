-- Student preparation reminders belong exclusively to the student profile.
-- Remove them automatically during permanent privacy deletion, regardless of
-- whether the account is closed through the administrative or LGPD workflow.
-- Financial retention and all other student records remain unchanged.
do $migration$
declare
  current_delete_action "char";
begin
  select constraint_definition.confdeltype
    into current_delete_action
  from pg_constraint as constraint_definition
  where constraint_definition.conrelid =
        'public.student_preparation_email_reminders'::regclass
    and constraint_definition.conname =
        'student_preparation_email_reminders_student_id_fkey'
    and constraint_definition.contype = 'f'
    and constraint_definition.confrelid = 'public.profiles'::regclass;

  if not found then
    raise exception 'Student preparation reminder foreign key not found.';
  end if;

  -- Safe to rerun if this migration has already been applied.
  if current_delete_action = 'c' then
    return;
  end if;

  -- Do not overwrite an unexpected referential-action configuration.
  if current_delete_action <> 'a' then
    raise exception 'Unexpected reminder delete action: %.', current_delete_action;
  end if;

  alter table public.student_preparation_email_reminders
    drop constraint student_preparation_email_reminders_student_id_fkey;

  alter table public.student_preparation_email_reminders
    add constraint student_preparation_email_reminders_student_id_fkey
    foreign key (student_id)
    references public.profiles(id)
    on delete cascade;
end;
$migration$;

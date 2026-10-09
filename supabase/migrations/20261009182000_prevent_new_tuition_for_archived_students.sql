-- Stop new charges from being generated for archived students.
-- Existing historical tuition remains available for reconciliation.

create or replace function private.reject_new_tuition_for_archived_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  archived_student boolean;
begin
  select coalesce(profile.archived, false)
    into archived_student
  from public.profiles as profile
  where profile.id = new.student_id
  for share;

  if coalesce(archived_student, false) then
    raise exception
      'Não é permitido gerar novas mensalidades para um aluno arquivado.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.reject_new_tuition_for_archived_student()
  from public, anon, authenticated;

drop trigger if exists monthly_tuition_prevent_archived_new_charge
  on public.monthly_tuition;

create trigger monthly_tuition_prevent_archived_new_charge
before insert or update of student_id on public.monthly_tuition
for each row
execute function private.reject_new_tuition_for_archived_student();

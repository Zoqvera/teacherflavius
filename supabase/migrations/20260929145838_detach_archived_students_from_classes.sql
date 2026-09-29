delete from public.class_students cs
where cs.user_id is not null
  and exists (
    select 1
    from public.profiles p
    where p.id = cs.user_id
      and coalesce(p.archived, false) = true
  );

create or replace function private.detach_archived_student_class_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.class_students
  where user_id = new.id;

  return new;
end;
$$;

revoke all on function private.detach_archived_student_class_memberships()
from public, anon, authenticated;

drop trigger if exists detach_archived_student_class_memberships_on_insert
on public.profiles;

create trigger detach_archived_student_class_memberships_on_insert
after insert on public.profiles
for each row
when (new.archived is true)
execute function private.detach_archived_student_class_memberships();

drop trigger if exists detach_archived_student_class_memberships_on_update
on public.profiles;

create trigger detach_archived_student_class_memberships_on_update
after update of archived on public.profiles
for each row
when (
  new.archived is true
  and old.archived is distinct from true
)
execute function private.detach_archived_student_class_memberships();

create or replace function private.prevent_archived_student_class_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = new.user_id
         and coalesce(p.archived, false) = true
     )
  then
    raise exception 'Aluno arquivado não pode ser vinculado a uma turma.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_archived_student_class_assignment()
from public, anon, authenticated;

drop trigger if exists prevent_archived_student_class_assignment_trigger
on public.class_students;

create trigger prevent_archived_student_class_assignment_trigger
before insert or update of user_id on public.class_students
for each row
execute function private.prevent_archived_student_class_assignment();

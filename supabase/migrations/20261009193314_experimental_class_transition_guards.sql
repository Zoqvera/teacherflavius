-- Keep permanent enrollment and one-off trial participants isolated during type changes.
set lock_timeout='5s';
set statement_timeout='60s';

create or replace function private.guard_experimental_class_transition()
returns trigger language plpgsql security definer set search_path='' as $func$
begin
  if new.class_type is not distinct from old.class_type then return new; end if;
  if new.class_type='experimental' and exists (
    select 1 from public.class_students cs where cs.class_number=new.class_number
  ) then
    raise exception 'Não é possível converter turma com matrículas regulares para EXPERIMENTAL.'
      using errcode='23514';
  end if;
  if old.class_type='experimental' and new.class_type is distinct from 'experimental'
    and exists (
      select 1 from private.trial_lesson_appointments a
      where a.class_number=new.class_number
        and a.status='scheduled' and a.starts_at>now()
    ) then
      raise exception 'Remarque os agendamentos futuros antes de mudar a categoria EXPERIMENTAL.'
        using errcode='23514';
  end if;
  return new;
end;
$func$;
drop trigger if exists guard_experimental_class_transition on public.teacher_classes;
create trigger guard_experimental_class_transition
before update of class_type on public.teacher_classes
for each row execute function private.guard_experimental_class_transition();

-- Replacement lessons must never consume experimental-session places.
create or replace function private.reject_experimental_makeup_slots()
returns trigger language plpgsql security definer set search_path='' as $func$
begin
 if new.class_number is not null and exists (
   select 1 from public.teacher_classes c
   where c.class_number=new.class_number and c.class_type='experimental'
 ) then
   raise exception 'Turmas EXPERIMENTAL não aceitam vagas de reposição.' using errcode='23514';
 end if;
 return new;
end;
$func$;
drop trigger if exists reject_experimental_makeup_slots on public.makeup_class_slots;
create trigger reject_experimental_makeup_slots
before insert or update of class_number on public.makeup_class_slots
for each row execute function private.reject_experimental_makeup_slots();

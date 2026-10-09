-- Add isolated experimental classes and safely recognize trial-to-enrollment conversions.
set lock_timeout='5s';
set statement_timeout='60s';
alter table public.teacher_classes drop constraint if exists teacher_classes_class_type_check;
alter table public.teacher_classes add constraint teacher_classes_class_type_check
  check (class_type is null or class_type in ('quintet','individual','experimental'));
alter table private.trial_lesson_appointments
  add column if not exists conversion_source text,
  add column if not exists matched_student_id uuid references public.profiles(id) on delete set null;
alter table private.trial_lesson_appointments add constraint trial_lesson_conversion_source_check
  check (conversion_source is null or conversion_source in ('automatic','manual','dismissed'));
update private.trial_lesson_appointments set conversion_source='manual'
where enrolled_after_trial_at is not null and conversion_source is null;
alter table private.trial_lesson_appointments drop constraint if exists trial_lesson_enrollment_completed_check;
alter table private.trial_lesson_appointments add constraint trial_lesson_enrollment_completed_check
  check (enrolled_after_trial_at is null or status='completed' or
    (conversion_source='automatic' and status in ('scheduled','no_show') and starts_at<now()));

create or replace function private.normalize_trial_phone(value text)
returns text language sql immutable set search_path='' as $func$
with clean as (select regexp_replace(coalesce(value,''),'[^0-9]','','g') digits),
national as (select case when length(digits) in (12,13) and left(digits,2)='55'
then substr(digits,3) else digits end digits from clean)
select case when length(digits) in (10,11) then digits else null end from national;
$func$;

create or replace function private.reconcile_past_trial_enrollments()
returns integer language plpgsql security definer set search_path='' as $func$
declare changes integer:=0; removed integer:=0;
begin
 with active_phone as (
   select private.normalize_trial_phone(p.whatsapp) phone,
      min(p.id::text)::uuid student_id,max(p.enrolled_at) enrolled_at
   from public.profiles p where p.enrolled=true and p.archived=false
      and private.normalize_trial_phone(p.whatsapp) is not null
   group by private.normalize_trial_phone(p.whatsapp) having count(*)=1
 )
 update private.trial_lesson_appointments trial
 set enrolled_after_trial_at=coalesce(trial.enrolled_after_trial_at,greatest(coalesce(student.enrolled_at,now()),trial.starts_at)),
     conversion_source='automatic',matched_student_id=student.student_id,updated_at=now()
 from active_phone student
 where trial.starts_at<now() and trial.status<>'cancelled'
   and student.phone=private.normalize_trial_phone(trial.whatsapp)
   and trial.conversion_source is distinct from 'manual'
   and trial.conversion_source is distinct from 'dismissed'
   and (trial.conversion_source is distinct from 'automatic'
        or trial.matched_student_id is distinct from student.student_id
        or trial.enrolled_after_trial_at is null);
 get diagnostics changes=row_count;
 with active_phone as (
   select private.normalize_trial_phone(p.whatsapp) phone,
     min(p.id::text)::uuid student_id from public.profiles p
   where p.enrolled=true and p.archived=false and private.normalize_trial_phone(p.whatsapp) is not null
   group by private.normalize_trial_phone(p.whatsapp) having count(*)=1
 )
 update private.trial_lesson_appointments trial
 set enrolled_after_trial_at=null,conversion_source=null,matched_student_id=null,updated_at=now()
 where trial.conversion_source='automatic'
   and (trial.starts_at>=now() or trial.status='cancelled' or not exists(
      select 1 from active_phone p where p.phone=private.normalize_trial_phone(trial.whatsapp)
        and p.student_id=trial.matched_student_id));
 get diagnostics removed=row_count;
 return changes+removed;
end;
$func$;

create or replace function private.reconcile_trial_profile_trigger()
returns trigger language plpgsql security definer set search_path='' as $func$
begin perform private.reconcile_past_trial_enrollments(); return new; end;
$func$;
drop trigger if exists reconcile_trial_conversion_insert on public.profiles;
create trigger reconcile_trial_conversion_insert after insert on public.profiles for each row
execute function private.reconcile_trial_profile_trigger();
drop trigger if exists reconcile_trial_conversion_update on public.profiles;
create trigger reconcile_trial_conversion_update after update of enrolled,archived,whatsapp on public.profiles for each row
when (old.enrolled is distinct from new.enrolled or old.archived is distinct from new.archived or old.whatsapp is distinct from new.whatsapp)
execute function private.reconcile_trial_profile_trigger();

create or replace function public.reconcile_teacher_trial_enrollments()
returns integer language plpgsql security definer set search_path='' as $func$
begin
 if not public.is_teacher_admin() then raise exception 'Acesso administrativo obrigatório.' using errcode='42501'; end if;
 return private.reconcile_past_trial_enrollments();
end;
$func$;
revoke all on function public.reconcile_teacher_trial_enrollments() from public,anon,authenticated;
grant execute on function public.reconcile_teacher_trial_enrollments() to authenticated;

create or replace function public.get_teacher_trial_conversion_sources()
returns table(appointment_id uuid,conversion_source text)
language plpgsql stable security definer set search_path='' as $func$
begin
 if not public.is_teacher_admin() then raise exception 'Acesso administrativo obrigatório.' using errcode='42501'; end if;
 return query select a.id,a.conversion_source from private.trial_lesson_appointments a where a.conversion_source is not null;
end;
$func$;
revoke all on function public.get_teacher_trial_conversion_sources() from public,anon,authenticated;
grant execute on function public.get_teacher_trial_conversion_sources() to authenticated;

create or replace function private.block_regular_enrollment_in_experimental()
returns trigger language plpgsql security definer set search_path='' as $func$
begin
 if exists(select 1 from public.teacher_classes where class_number=new.class_number and class_type='experimental') then
   raise exception 'Participantes experimentais não são matrículas regulares.' using errcode='23514';
 end if;
 return new;
end;
$func$;
drop trigger if exists reject_regular_in_experimental on public.class_students;
create trigger reject_regular_in_experimental before insert or update of class_number
on public.class_students for each row execute function private.block_regular_enrollment_in_experimental();

create or replace function private.check_experimental_booking()
returns trigger language plpgsql security definer set search_path='' as $func$
declare phone text; capacity integer; occupied integer;
begin
 if new.status<>'scheduled' or new.starts_at<=now() then return new; end if;
 phone:=private.normalize_trial_phone(new.whatsapp);
 if phone is null then raise exception 'Informe celular válido com DDD.' using errcode='22023'; end if;
 if exists(select 1 from public.profiles p where p.enrolled=true and p.archived=false
   and private.normalize_trial_phone(p.whatsapp)=phone) then
   raise exception 'Este celular já pertence a aluno matriculado.' using errcode='23514';
 end if;
 if new.class_number is not null then
   if not exists(select 1 from public.teacher_classes c where c.class_number=new.class_number
       and c.class_type='experimental' and c.is_active) then
     raise exception 'Selecione turma EXPERIMENTAL ativa.' using errcode='23514';
   end if;
   perform pg_catalog.pg_advisory_xact_lock(73008,new.class_number);
   capacity:=private.get_class_operational_capacity(new.class_number);
   select count(*)::integer into occupied from private.trial_lesson_appointments t
   where t.class_number=new.class_number and t.starts_at=new.starts_at and t.status='scheduled'
     and (tg_op='INSERT' or t.id<>new.id);
   if capacity is null or occupied>=capacity then
     raise exception 'Sem vagas experimentais nesta turma e data.' using errcode='23514';
   end if;
 end if;
 return new;
end;
$func$;
drop trigger if exists validate_new_experimental_booking on private.trial_lesson_appointments;
create trigger validate_new_experimental_booking before insert or update of whatsapp,starts_at,class_number,status
on private.trial_lesson_appointments for each row execute function private.check_experimental_booking();

do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.create_teacher_class_with_type__mfa_inner(text,text)'::regprocedure) into original;
  if position($match$('quintet','individual')$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.create_teacher_class_with_type__mfa_inner(text,text)';
  end if;
  changed:=replace(original,$match$('quintet','individual')$match$,$replace$('quintet','individual','experimental')$replace$);
  if position($match$case when normalized_type = 'quintet' then 8 else null end$match$ in changed)=0 then raise exception 'Second definition pattern missing: public.create_teacher_class_with_type__mfa_inner(text,text)'; end if;
  changed:=replace(changed,$match$case when normalized_type = 'quintet' then 8 else null end$match$,$replace$case when normalized_type in ('quintet','experimental') then 8 else null end$replace$);
  execute changed;
end;
$patch$;
do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.set_teacher_class_type__mfa_inner(integer,text)'::regprocedure) into original;
  if position($match$('quintet','individual')$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.set_teacher_class_type__mfa_inner(integer,text)';
  end if;
  changed:=replace(original,$match$('quintet','individual')$match$,$replace$('quintet','individual','experimental')$replace$);
  if position($match$when normalized_type = 'quintet' then 8$match$ in changed)=0 then raise exception 'Second definition pattern missing: public.set_teacher_class_type__mfa_inner(integer,text)'; end if;
  changed:=replace(changed,$match$when normalized_type = 'quintet' then 8$match$,$replace$when normalized_type in ('quintet','experimental') then 8$replace$);
  execute changed;
end;
$patch$;
do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.get_teacher_trial_lesson_classes()'::regprocedure) into original;
  if position($match$tc.class_type = 'quintet'$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.get_teacher_trial_lesson_classes()';
  end if;
  changed:=replace(original,$match$tc.class_type = 'quintet'$match$,$replace$tc.class_type = 'experimental'$replace$);
  
  execute changed;
end;
$patch$;
do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer)'::regprocedure) into original;
  if position($match$tc.class_type = 'quintet'$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer)';
  end if;
  changed:=replace(original,$match$tc.class_type = 'quintet'$match$,$replace$tc.class_type = 'experimental'$replace$);
  
  execute changed;
end;
$patch$;
do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.update_teacher_trial_lesson(uuid,text,text,text,text,date,time without time zone,integer)'::regprocedure) into original;
  if position($match$tc.class_type = 'quintet'$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.update_teacher_trial_lesson(uuid,text,text,text,text,date,time without time zone,integer)';
  end if;
  changed:=replace(original,$match$tc.class_type = 'quintet'$match$,$replace$tc.class_type = 'experimental'$replace$);
  
  execute changed;
end;
$patch$;
do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.get_teacher_trial_lessons()'::regprocedure) into original;
  if position($match$limit 200$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.get_teacher_trial_lessons()';
  end if;
  changed:=replace(original,$match$limit 200$match$,$replace$limit 1000$replace$);
  
  execute changed;
end;
$patch$;
do $patch$
declare original text; changed text;
begin
  select pg_get_functiondef('public.get_teacher_classes_with_type__mfa_inner()'::regprocedure) into original;
  if position($match$count(cs.id)::integer as student_count$match$ in original)=0 then
    raise exception 'Expected definition pattern missing: public.get_teacher_classes_with_type__mfa_inner()';
  end if;
  changed:=replace(original,$match$count(cs.id)::integer as student_count$match$,$replace$case when tc.class_type='experimental' then (
select count(*)::integer from private.trial_lesson_appointments a where a.class_number=tc.class_number and a.status='scheduled' and a.starts_at=(
select min(b.starts_at) from private.trial_lesson_appointments b where b.class_number=tc.class_number and b.starts_at>now() and b.status='scheduled')
) else count(cs.id)::integer end as student_count$replace$);
  
  execute changed;
end;
$patch$;

-- Preserve the manual toggle and record its origin. A dismissal overrides future automatic matching.
create or replace function public.set_teacher_trial_lesson_enrollment(target_appointment_id uuid,target_enrolled boolean)
returns void language plpgsql security definer set search_path='public','private','pg_temp' as $func$
declare current_status text;
begin
 if not public.is_teacher_admin() then raise exception 'Acesso administrativo obrigatório.' using errcode='42501'; end if;
 if target_enrolled is null then raise exception 'Informe matrícula.' using errcode='22023'; end if;
 select status into current_status from private.trial_lesson_appointments where id=target_appointment_id for update;
 if not found then raise exception 'Agendamento não encontrado.' using errcode='P0002'; end if;
 if target_enrolled and current_status<>'completed' then
   raise exception 'Registro manual exige aula concluída.' using errcode='22023';
 end if;
 update private.trial_lesson_appointments set
   enrolled_after_trial_at=case when target_enrolled then coalesce(enrolled_after_trial_at,now()) else null end,
   enrolled_after_trial_by=case when target_enrolled then auth.uid() else null end,
   conversion_source=case when target_enrolled then 'manual' else 'dismissed' end,
   matched_student_id=case when target_enrolled then matched_student_id else null end,
   updated_at=now()
 where id=target_appointment_id;
end;
$func$;

-- Automatic update on profile changes; protected read refresh also reconciles elapsed trial times.
update public.teacher_classes tc
set class_type='experimental', capacity_override=case when tc.class_number=92 then 10 else 8 end,updated_at=now()
where tc.class_number in (89,90,91,92,94) and tc.class_type='quintet'
and not exists(select 1 from public.class_students cs where cs.class_number=tc.class_number);
select private.reconcile_past_trial_enrollments();
comment on column public.teacher_classes.class_type is 'individual/quintet regular formats; experimental denotes visitor-only classes.';
comment on column private.trial_lesson_appointments.conversion_source is 'Automatic phone match with exactly one active student, manual confirmation, or dismissed override.';

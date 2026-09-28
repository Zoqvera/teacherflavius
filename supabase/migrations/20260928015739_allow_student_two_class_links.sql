drop index if exists public.class_students_one_class_per_user_idx;
drop index if exists public.class_students_one_class_per_invite_idx;

create or replace function public.enforce_class_students_max_two_classes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  assignment_count integer;
  subject_key text;
begin
  if new.user_id is not null then
    subject_key := 'user:' || new.user_id::text;

    if exists (
      select 1
      from public.class_students cs
      where cs.class_number = new.class_number
        and cs.user_id = new.user_id
        and (tg_op <> 'UPDATE' or cs.id <> new.id)
    ) then
      return new;
    end if;
  elsif new.invite_id is not null then
    subject_key := 'invite:' || new.invite_id::text;

    if exists (
      select 1
      from public.class_students cs
      where cs.class_number = new.class_number
        and cs.invite_id = new.invite_id
        and (tg_op <> 'UPDATE' or cs.id <> new.id)
    ) then
      return new;
    end if;
  else
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(subject_key, 73009)
  );

  if new.user_id is not null then
    select count(*)::integer
    into assignment_count
    from public.class_students cs
    where cs.user_id = new.user_id
      and (tg_op <> 'UPDATE' or cs.id <> new.id);
  else
    select count(*)::integer
    into assignment_count
    from public.class_students cs
    where cs.invite_id = new.invite_id
      and (tg_op <> 'UPDATE' or cs.id <> new.id);
  end if;

  if assignment_count >= 2 then
    raise exception 'O aluno já está vinculado ao limite de 2 turmas.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_class_students_max_two_classes()
  from public, anon, authenticated;
grant execute on function public.enforce_class_students_max_two_classes()
  to service_role;

drop trigger if exists enforce_class_students_max_two_classes_trigger
  on public.class_students;

create trigger enforce_class_students_max_two_classes_trigger
before insert or update of class_number, user_id, invite_id
on public.class_students
for each row
execute function public.enforce_class_students_max_two_classes();

create or replace function public.add_teacher_class_student_by_ref__mfa_inner(
  target_class_number integer,
  target_student_ref_id text,
  target_student_ref_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  inserted_id uuid;
  target_user_id uuid;
  target_invite_id uuid;
  student_type text;
  student_type_internal text;
  class_type_value text;
  assignment_count integer;
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso negado: usuário não cadastrado como professor.';
  end if;

  perform public.assert_teacher_class_exists(target_class_number);

  select tc.class_type into class_type_value
  from public.teacher_classes tc
  where tc.class_number = target_class_number
    and tc.is_active = true;

  if class_type_value is null then
    raise exception 'Defina a etiqueta da turma antes de matricular alunos.';
  end if;

  if target_student_ref_type = 'user' then
    target_user_id := target_student_ref_id::uuid;

    if not exists (
      select 1
      from auth.users u
      where u.id = target_user_id
        and not exists (
          select 1
          from public.teacher_admins ta
          where lower(ta.email) = lower(u.email)
        )
    ) then
      raise exception 'Aluno não encontrado.';
    end if;

    select p.class_type into student_type
    from public.profiles p
    where p.id = target_user_id;
  elsif target_student_ref_type = 'invite' then
    target_invite_id := target_student_ref_id::uuid;

    if not exists (
      select 1
      from public.student_enrollment_invites sei
      where sei.id = target_invite_id
        and sei.status in ('pending', 'completed')
    ) then
      raise exception 'Pré-matrícula não encontrada.';
    end if;

    select p.class_type into student_type
    from public.student_enrollment_invites sei
    join public.profiles p on p.id = sei.user_id
    where sei.id = target_invite_id;
  else
    raise exception 'Tipo de aluno inválido.';
  end if;

  if student_type is null then
    raise exception 'Classifique o tipo de turma do aluno antes de matriculá-lo.';
  end if;

  student_type_internal := case upper(trim(student_type))
    when 'INDIVIDUAL' then 'individual'
    when 'QUARTETO' then 'quartet'
    when 'QUINTETO' then 'quintet'
    when '8 ALUNOS' then 'eight_students'
    else null
  end;

  if student_type_internal is null then
    raise exception 'Tipo de turma do aluno inválido: %.', student_type;
  end if;

  if student_type_internal <> class_type_value then
    raise exception 'Tipo incompatível: aluno % e turma %.',
      student_type,
      case class_type_value
        when 'individual' then 'INDIVIDUAL'
        when 'quartet' then 'QUARTETO'
        when 'quintet' then 'QUINTETO'
        when 'eight_students' then '8 ALUNOS'
        else class_type_value
      end;
  end if;

  if target_student_ref_type = 'user' then
    insert into public.class_students (class_number, user_id, invite_id)
    values (target_class_number, target_user_id, null)
    on conflict (class_number, user_id) do update
    set user_id = excluded.user_id,
        invite_id = null
    returning id into inserted_id;

    select count(*)::integer into assignment_count
    from public.class_students
    where user_id = target_user_id;
  else
    insert into public.class_students (class_number, user_id, invite_id)
    values (target_class_number, null, target_invite_id)
    on conflict (class_number, invite_id) where invite_id is not null do update
    set invite_id = excluded.invite_id,
        user_id = null
    returning id into inserted_id;

    select count(*)::integer into assignment_count
    from public.class_students
    where invite_id = target_invite_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', inserted_id,
    'class_number', target_class_number,
    'class_type', class_type_value,
    'assignment_count', assignment_count,
    'assignment_limit', 2
  );
end;
$function$;

create or replace function public.migrate_invite_records_to_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  distinct_class_count integer;
begin
  if new.status = 'completed' and new.user_id is not null then
    select count(*)::integer
    into distinct_class_count
    from (
      select cs.class_number
      from public.class_students cs
      where cs.user_id = new.user_id
      union
      select cs.class_number
      from public.class_students cs
      where cs.invite_id = new.id
    ) classes;

    if distinct_class_count > 2 then
      raise exception 'A conclusão da matrícula deixaria o aluno vinculado a mais de 2 turmas.';
    end if;

    delete from public.class_students invite_assignment
    using public.class_students user_assignment
    where invite_assignment.invite_id = new.id
      and user_assignment.user_id = new.user_id
      and user_assignment.class_number = invite_assignment.class_number;

    update public.class_students
    set user_id = new.user_id,
        invite_id = null
    where invite_id = new.id
      and user_id is null;

    update public.student_frequency
    set user_id = new.user_id
    where invite_id = new.id
      and user_id is null;
  end if;

  return new;
end;
$function$;

comment on function public.enforce_class_students_max_two_classes()
is 'Enforces the operational invariant that each student or pre-enrollment can be linked to at most two classes.';

comment on function public.add_teacher_class_student_by_ref__mfa_inner(integer, text, text)
is 'Adds a student or pre-enrollment to a compatible class while preserving existing links up to the two-class limit.';

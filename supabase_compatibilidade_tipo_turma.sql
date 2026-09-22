-- Restringe a matrícula para que o tipo do aluno corresponda à etiqueta da turma.
-- Aluno: INDIVIDUAL / QUARTETO / QUINTETO / 8 ALUNOS
-- Turma (interno): individual / quartet / quintet / eight_students

create or replace function public.add_teacher_class_student_by_ref(
  target_class_number integer,
  target_student_ref_id text,
  target_student_ref_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inserted_id uuid;
  target_user_id uuid;
  target_invite_id uuid;
  student_type text;
  student_type_internal text;
  class_type_value text;
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso negado: usuário não cadastrado como professor.';
  end if;

  perform public.assert_teacher_class_exists(target_class_number);

  select tc.class_type into class_type_value
  from public.teacher_classes tc
  where tc.class_number = target_class_number and tc.is_active = true;

  if class_type_value is null then
    raise exception 'Defina a etiqueta da turma antes de matricular alunos.';
  end if;

  if target_student_ref_type = 'user' then
    target_user_id := target_student_ref_id::uuid;

    if not exists (
      select 1 from auth.users u
      where u.id = target_user_id
        and not exists (
          select 1 from public.teacher_admins ta
          where lower(ta.email) = lower(u.email)
        )
    ) then
      raise exception 'Aluno não encontrado.';
    end if;

    select p.class_type into student_type
    from public.profiles p where p.id = target_user_id;

  elsif target_student_ref_type = 'invite' then
    target_invite_id := target_student_ref_id::uuid;

    if not exists (
      select 1 from public.student_enrollment_invites sei
      where sei.id = target_invite_id and sei.status in ('pending', 'completed')
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
        when 'eight_students' then '8 ALUNOS'
        else class_type_value
      end;
  end if;

  if target_student_ref_type = 'user' then
    delete from public.class_students
    where user_id = target_user_id and class_number <> target_class_number;

    insert into public.class_students (class_number, user_id, invite_id)
    values (target_class_number, target_user_id, null)
    on conflict (class_number, user_id) do update
    set user_id = excluded.user_id, invite_id = null
    returning id into inserted_id;
  else
    delete from public.class_students
    where invite_id = target_invite_id and class_number <> target_class_number;

    insert into public.class_students (class_number, user_id, invite_id)
    values (target_class_number, null, target_invite_id)
    on conflict (class_number, invite_id) where invite_id is not null do update
    set invite_id = excluded.invite_id, user_id = null
    returning id into inserted_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', inserted_id,
    'class_number', target_class_number,
    'class_type', class_type_value
  );
end;
$$;

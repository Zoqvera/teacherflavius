create or replace function public.switch_my_group_class(target_class_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  old_class_number integer;
  current_class_count integer;
  occupied_count integer;
  caller_class_type text;
  target_db_type text;
  capacity integer;
begin
  if caller_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select p.class_type into caller_class_type
  from public.profiles p
  where p.id = caller_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if caller_class_type is null then
    raise exception 'Seu tipo de turma ainda não foi definido pelo professor.'
      using errcode = '42501';
  end if;

  target_db_type := case caller_class_type
    when 'INDIVIDUAL' then 'individual'
    when 'QUARTETO' then 'quartet'
    when 'QUINTETO' then 'quintet'
    when '8 ALUNOS' then 'eight_students'
    else null
  end;

  if target_db_type is null then
    raise exception 'Tipo de turma inválido no perfil do aluno.';
  end if;

  select count(*)::integer, min(cs.class_number)
  into current_class_count, old_class_number
  from public.class_students cs
  where cs.user_id = caller_id;

  if current_class_count > 1 then
    raise exception 'Você está vinculado a duas turmas. A troca deve ser feita pelo professor para preservar os dois vínculos.'
      using errcode = 'P0001';
  end if;

  if old_class_number = target_class_number then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'old_class_number', old_class_number,
      'new_class_number', target_class_number
    );
  end if;

  perform 1
  from public.teacher_classes tc
  where tc.class_number = target_class_number
    and tc.is_active = true
    and tc.class_type = target_db_type
  for update;

  if not found then
    raise exception 'Esta turma não é compatível com o seu tipo de turma.';
  end if;

  capacity := private.get_class_operational_capacity(target_class_number);
  if capacity is null then
    raise exception 'A capacidade desta turma não está configurada.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73007, target_class_number);

  select count(*)::integer into occupied_count
  from public.class_students cs
  left join public.profiles p on p.id = cs.user_id
  where cs.class_number = target_class_number
    and (
      cs.invite_id is not null
      or (
        cs.user_id is not null
        and coalesce(p.enrolled, false) = true
        and coalesce(p.archived, false) = false
      )
    );

  if occupied_count >= capacity then
    raise exception 'Esta turma não possui mais vagas.';
  end if;

  if old_class_number is not null then
    delete from public.class_students
    where user_id = caller_id
      and class_number = old_class_number;
  end if;

  insert into public.class_students (class_number, user_id, invite_id)
  values (target_class_number, caller_id, null);

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'old_class_number', old_class_number,
    'new_class_number', target_class_number,
    'available_spots_after_change', capacity - occupied_count - 1
  );
end;
$function$;

comment on function public.switch_my_group_class(integer)
is 'Allows self-service switching only for students with zero or one current class; students with two class links must use teacher-managed changes to prevent accidental link loss.';

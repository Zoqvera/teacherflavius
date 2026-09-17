create or replace function private.reconcile_student_exercise_completion_ids(target_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recovered_count integer := 0;
begin
  insert into public.daily_exercise_completion (
    user_id,
    exercise_id,
    exercise_title,
    exercise_url,
    completed,
    completed_at,
    completion_source,
    completed_by,
    completed_by_email,
    created_at,
    updated_at
  )
  select
    target_user_id,
    te.exercise_id,
    te.exercise_title,
    te.exercise_url,
    true,
    (
      select max(history.completed_at)
      from public.daily_exercise_completion history
      where history.user_id = target_user_id
        and history.completed = true
        and nullif(trim(history.exercise_title), '') is not null
        and lower(trim(history.exercise_title)) = lower(trim(te.exercise_title))
    ),
    'legacy',
    null,
    null,
    now(),
    now()
  from public.teacher_exercises te
  where te.is_active = true
    and (te.scheduled_publish_at is null or te.scheduled_publish_at <= now())
    and not exists (
      select 1
      from public.daily_exercise_completion current_record
      where current_record.user_id = target_user_id
        and current_record.exercise_id = te.exercise_id
    )
    and exists (
      select 1
      from public.daily_exercise_completion history
      where history.user_id = target_user_id
        and history.completed = true
        and nullif(trim(history.exercise_title), '') is not null
        and lower(trim(history.exercise_title)) = lower(trim(te.exercise_title))
    )
  on conflict (user_id, exercise_id) do nothing;

  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

revoke all on function private.reconcile_student_exercise_completion_ids(uuid) from public, anon, authenticated;
grant execute on function private.reconcile_student_exercise_completion_ids(uuid) to service_role;

create or replace function public.unarchive_teacher_student__mfa_inner(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership record;
  occupied_count integer;
  capacity_limit integer;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = target_user_id and p.archived = true
  ) then
    raise exception 'Aluno arquivado não encontrado.';
  end if;

  for membership in
    select tc.class_number, tc.class_name
    from public.class_students cs
    join public.teacher_classes tc on tc.class_number = cs.class_number
    where cs.user_id = target_user_id
      and tc.is_active = true
  loop
    capacity_limit := private.get_class_operational_capacity(membership.class_number);
    if capacity_limit is null then
      raise exception 'A capacidade da turma % não está configurada.', membership.class_number;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(73008, membership.class_number);

    select count(*)::integer into occupied_count
    from public.class_students cs
    left join public.profiles p on p.id = cs.user_id
    where cs.class_number = membership.class_number
      and cs.user_id is distinct from target_user_id
      and (
        cs.invite_id is not null
        or (
          cs.user_id is not null
          and coalesce(p.enrolled, false) = true
          and coalesce(p.archived, false) = false
        )
      );

    if occupied_count >= capacity_limit then
      raise exception 'Não é possível reativar o aluno: a turma % já atingiu o limite de % alunos.', membership.class_name, capacity_limit;
    end if;
  end loop;

  update public.profiles
  set archived = false,
      archived_at = null
  where id = target_user_id
    and archived = true;

  perform private.reconcile_student_exercise_completion_ids(target_user_id);
end;
$$;

revoke all on function public.unarchive_teacher_student__mfa_inner(uuid) from public, anon, authenticated;
grant execute on function public.unarchive_teacher_student__mfa_inner(uuid) to service_role;

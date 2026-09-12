create or replace function public.ensure_weekly_plan_snapshot(target_user_id uuid)
returns table(
  id uuid,
  user_id uuid,
  week_number integer,
  week_start date,
  week_end date,
  roadmap_target_lesson integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  schedule_start date;
  created_date date;
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  computed_week integer;
  computed_start date;
  computed_end date;
  target_lesson integer;
begin
  if caller_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  if caller_id <> target_user_id
     and not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select
    p.exercise_schedule_start_date,
    (p.created_at at time zone 'America/Sao_Paulo')::date
  into schedule_start, created_date
  from public.profiles p
  where p.id = target_user_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if not found then
    raise exception 'Aluno ativo não encontrado.';
  end if;

  schedule_start := coalesce(
    schedule_start,
    case
      when created_date is null or created_date <= date '2026-07-30' then date '2026-07-30'
      else created_date
    end
  );

  computed_week := greatest(1, floor((local_today - schedule_start)::numeric / 7)::integer + 1);
  computed_start := schedule_start + ((computed_week - 1) * 7);
  computed_end := computed_start + 6;

  select min(gs.n)
  into target_lesson
  from generate_series(1, 24) as gs(n)
  where not exists (
    select 1
    from public.study_roadmap_completion src
    where src.user_id = target_user_id
      and src.lesson_number = gs.n
      and src.completed = true
  );

  insert into public.weekly_plan_snapshots (
    user_id,
    week_number,
    week_start,
    week_end,
    roadmap_target_lesson
  ) values (
    target_user_id,
    computed_week,
    computed_start,
    computed_end,
    target_lesson
  )
  on conflict on constraint weekly_plan_snapshots_user_week_key do nothing;

  return query
  select
    s.id,
    s.user_id,
    s.week_number,
    s.week_start,
    s.week_end,
    s.roadmap_target_lesson,
    s.created_at
  from public.weekly_plan_snapshots s
  where s.user_id = target_user_id
    and s.week_start = computed_start
  limit 1;
end;
$$;

create or replace function public.set_my_weekly_task_completed(
  target_task_id uuid,
  target_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  task_owner uuid;
begin
  if caller_id is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;

  select t.user_id
  into task_owner
  from public.weekly_student_tasks t
  where t.id = target_task_id;

  if task_owner is null then
    raise exception 'Tarefa não encontrada.';
  end if;

  if caller_id <> task_owner
     and not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.weekly_student_tasks
  set completed = coalesce(target_completed, false),
      completed_at = case
        when coalesce(target_completed, false) then coalesce(completed_at, now())
        else null
      end,
      updated_at = now()
  where id = target_task_id;
end;
$$;

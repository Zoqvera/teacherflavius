-- ETAPA 5 — evidência explícita do encerramento formal para a retenção acadêmica.
-- NÃO interpreta arquivamento como desligamento; NÃO elimina dados ou ativa o módulo.
-- Nenhum período anterior à implantação é inferido automaticamente.
create table public.homework_relationship_events (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('ended', 'resumed')),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  constraint homework_relationship_time_not_future
    check (occurred_at <= recorded_at + interval '5 minutes')
);

create index homework_relationship_events_student_latest_idx
  on public.homework_relationship_events(student_id, id desc);

alter table public.homework_relationship_events enable row level security;
revoke all on public.homework_relationship_events from public, anon, authenticated;
revoke all on sequence public.homework_relationship_events_id_seq from public, anon, authenticated;
grant select, insert on public.homework_relationship_events to service_role;
grant usage, select on sequence public.homework_relationship_events_id_seq to service_role;

-- Somente um professor com MFA pode declarar o encerramento ou a retomada.
-- O registro não arquiva, desarquiva, cobra nem exclui alunos.
create function public.homework_record_relationship_event(
  p_student_id uuid, p_event_type text
) returns jsonb
language plpgsql security definer set search_path = ''
as $relationship$
declare
  profile_row public.profiles%rowtype;
  prior_type text;
  inserted_id bigint;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação reforçada do professor obrigatória.'
      using errcode = '42501';
  end if;
  if p_student_id is null or p_event_type not in ('ended', 'resumed')
     or p_event_type is null then
    raise exception 'Evento de vínculo inválido.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.teacher_admins where user_id = p_student_id
  ) then
    raise exception 'Conta de professor não pode ser encerrada como aluno.'
      using errcode = '42501';
  end if;

  -- Serializa transições concorrentes usando a linha persistente do aluno.
  select p.* into profile_row from public.profiles p
    where p.id = p_student_id for update;
  if not found then
    raise exception 'Aluno não encontrado.' using errcode = '22023';
  end if;
  if p_event_type = 'ended' and
     (profile_row.archived is not true or profile_row.archived_at is null) then
    raise exception 'Arquive o aluno antes de registrar o desligamento formal.'
      using errcode = '22023';
  end if;
  if p_event_type = 'resumed' and profile_row.archived is true then
    raise exception 'Reative o aluno antes de registrar a retomada do vínculo.'
      using errcode = '22023';
  end if;

  select e.event_type into prior_type
    from public.homework_relationship_events e
    where e.student_id = p_student_id
    order by e.id desc limit 1;

  if prior_type = p_event_type or (prior_type is null and p_event_type = 'resumed') then
    raise exception 'Transição formal duplicada ou sem encerramento anterior.'
      using errcode = '22023';
  end if;

  insert into public.homework_relationship_events
    (student_id, event_type, occurred_at, recorded_by)
  values (p_student_id, p_event_type, now(), auth.uid())
  returning id into inserted_id;

  return jsonb_build_object(
    'event_id', inserted_id,
    'student_id', p_student_id,
    'event_type', p_event_type,
    'occurred_at', now(),
    'automatic_deletion', false
  );
end;
$relationship$;

revoke all on function public.homework_record_relationship_event(uuid,text)
  from public, anon, authenticated;
grant execute on function public.homework_record_relationship_event(uuid,text)
  to authenticated;

-- Dados mínimos para prévia, sem dados de texto e sem qualquer DELETE.
-- Uma reativação, mesmo seguida por novo arquivamento sem nova confirmação,
-- invalida o prazo antigo: archived_at deve anteceder o evento formal.
create function private.homework_retention_candidates()
returns table (
  student_id uuid,
  ended_at timestamptz,
  eligible_at timestamptz,
  attempt_count bigint,
  feedback_count bigint
)
language sql stable security invoker set search_path = ''
as $candidates$
  with latest as (
    select distinct on (e.student_id)
      e.student_id, e.event_type, e.occurred_at
    from public.homework_relationship_events e
    order by e.student_id, e.id desc
  )
  select
    p.id, latest.occurred_at,
    latest.occurred_at + interval '12 months',
    count(distinct a.id),
    count(distinct f.id)
  from latest
  join public.profiles p on p.id = latest.student_id
  left join public.exercise_attempts a on a.student_id = p.id
  left join public.exercise_feedback f on f.attempt_id = a.id
  where latest.event_type = 'ended'
    and p.archived is true
    and p.archived_at is not null
    and p.archived_at <= latest.occurred_at
    and latest.occurred_at + interval '12 months' <= now()
  group by p.id, latest.occurred_at
  order by latest.occurred_at, p.id;
$candidates$;

revoke all on function private.homework_retention_candidates()
  from public, anon, authenticated;

-- Consulta administrativa em MFA. Limite de 100 e zero conteúdo pedagógico.
create function public.homework_retention_preview(p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $preview$
declare
  result jsonb;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação reforçada do professor obrigatória.'
      using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Limite deve estar entre 1 e 100.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id', eligible.student_id,
    'ended_at', eligible.ended_at,
    'eligible_at', eligible.eligible_at,
    'attempt_count', eligible.attempt_count,
    'feedback_count', eligible.feedback_count
  ) order by eligible.eligible_at), '[]'::jsonb) into result
  from (
    select * from private.homework_retention_candidates()
    limit p_limit
  ) eligible;

  return jsonb_build_object(
    'mode', 'dry_run',
    'automatic_deletion', false,
    'retention', '12 calendar months after confirmed formal end',
    'candidates', result
  );
end;
$preview$;

revoke all on function public.homework_retention_preview(integer)
  from public, anon, authenticated;
grant execute on function public.homework_retention_preview(integer)
  to authenticated;

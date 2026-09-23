-- Geração automática de horários de reposição para os próximos 30 dias.
-- Regras de capacidade de reposição:
-- A capacidade de matrícula regular da turma não é alterada.
-- Cada horário automático recebe três vagas extras exclusivas para reposição.
-- 4 alunos -> 4 vagas de reposição
-- 3 alunos -> 5 vagas de reposição
-- 2 alunos -> 6 vagas de reposição
-- 1 aluno  -> nenhuma vaga
-- A duração segue o padrão atual das reposições: 60 minutos.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.makeup_class_slots
  add column if not exists is_auto_generated boolean not null default false;

create or replace function public.sync_auto_makeup_slots_30_days()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer := 0;
  inserted_count integer := 0;
begin
  -- Recalcula somente horários automáticos futuros sem qualquer reserva vinculada.
  -- Reservas confirmadas, canceladas ou históricas preservam o horário referenciado.
  delete from public.makeup_class_slots s
  where s.is_auto_generated = true
    and s.starts_at > now()
    and not exists (
      select 1
      from public.makeup_class_bookings b
      where b.slot_id = s.id
    );
  get diagnostics deleted_count = row_count;

  with student_counts as (
    select
      tc.class_number,
      count(cs.id) filter (
        where cs.invite_id is not null
           or (
             cs.user_id is not null
             and coalesce(p.enrolled, false) = true
             and coalesce(p.archived, false) = false
           )
      )::integer as student_count
    from public.teacher_classes tc
    left join public.class_students cs
      on cs.class_number = tc.class_number
    left join public.profiles p
      on p.id = cs.user_id
    where tc.is_active = true
    group by tc.class_number
  ), desired as (
    select
      tc.class_number,
      coalesce(nullif(trim(tc.class_name), ''), 'Turma ' || tc.class_number)::text as class_name,
      nullif(trim(cr.video_lesson_url), '')::text as meeting_url,
      d::date as class_date,
      ((d::date + tc.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((d::date + tc.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at,
      case
        when sc.student_count between 2 and 4
          then (5 - sc.student_count) + 3
        else 0
      end::integer as capacity
    from public.teacher_classes tc
    join student_counts sc
      on sc.class_number = tc.class_number
    left join public.class_resources cr
      on cr.class_number = tc.class_number
    cross join generate_series(
      (now() at time zone 'America/Sao_Paulo')::date,
      (now() at time zone 'America/Sao_Paulo')::date + 29,
      interval '1 day'
    ) as d
    where tc.is_active = true
      and coalesce(tc.makeup_slots_enabled, true) = true
      and tc.class_weekday between 1 and 7
      and tc.class_start_time is not null
      and extract(isodow from d)::integer = tc.class_weekday
      and sc.student_count in (2, 3, 4)
      and nullif(trim(cr.video_lesson_url), '') ~* '^https?://'
  )
  insert into public.makeup_class_slots (
    class_number,
    class_name,
    meeting_url,
    starts_at,
    ends_at,
    capacity,
    notes,
    is_active,
    created_by,
    is_auto_generated
  )
  select
    d.class_number,
    d.class_name,
    d.meeting_url,
    d.starts_at,
    d.ends_at,
    d.capacity,
    null,
    true,
    null,
    true
  from desired d
  where d.starts_at > now()
    and not exists (
      select 1
      from public.makeup_class_slots existing
      where existing.class_number = d.class_number
        and existing.starts_at = d.starts_at
        and existing.is_active = true
    );
  get diagnostics inserted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'window_days', 30,
    'deleted_unbooked_auto_slots', deleted_count,
    'inserted_auto_slots', inserted_count,
    'generated_at', now()
  );
end;
$$;

-- A função é interna e executada apenas pelo job do banco.
revoke all on function public.sync_auto_makeup_slots_30_days() from public;
revoke all on function public.sync_auto_makeup_slots_30_days() from anon;
revoke all on function public.sync_auto_makeup_slots_30_days() from authenticated;
grant execute on function public.sync_auto_makeup_slots_30_days() to postgres;

-- Executa diariamente às 06:15 UTC (03:15 em Brasília), mantendo sempre
-- uma janela móvel de 30 dias de reposições futuras.
select cron.schedule(
  'sync-auto-makeup-slots-30-days',
  '15 6 * * *',
  $$select public.sync_auto_makeup_slots_30_days();$$
);

-- Preenche a janela imediatamente após a instalação.
select public.sync_auto_makeup_slots_30_days();

-- Hotfix operacional aplicado em 03/11/2026.
-- Registra aulas nao ministradas sem alterar frequencia administrativa,
-- presenca historica ou creditos de reposicao ja concedidos.
-- Nao inserir esta versao no ledger de migrations sem reconciliar a producao.
begin;

create table if not exists private.academic_non_instructional_class_dates (
  class_number integer not null check (class_number > 0),
  class_date date not null,
  reason text not null check (length(btrim(reason)) >= 10),
  created_at timestamptz not null default now(),
  primary key (class_number, class_date)
);

comment on table private.academic_non_instructional_class_dates is
  'Sessoes sem aula efetiva nao reiniciam o ciclo pedagogico; a frequencia administrativa e os creditos permanecem intactos.';

revoke all on table private.academic_non_instructional_class_dates
  from public, anon, authenticated;

insert into private.academic_non_instructional_class_dates
  (class_number, class_date, reason)
values
  (52, date '2026-10-27',
    'Aula nao ministrada pelo professor; preservar frequencia administrativa e creditos de reposicao.'),
  (53, date '2026-10-27',
    'Aula nao ministrada pelo professor; preservar frequencia administrativa e creditos de reposicao.')
on conflict (class_number, class_date) do nothing;

do $hotfix$
declare
  current_definition text;
  original_filter constant text := $original$
        where prior.student_id = scheduled.student_id
          and prior.starts_at < scheduled.starts_at
          and prior.attendance_status in ('present', 'absent')
        order by prior.starts_at desc$original$;
  corrected_filter constant text := $corrected$
        where prior.student_id = scheduled.student_id
          and prior.starts_at < scheduled.starts_at
          and prior.attendance_status in ('present', 'absent')
          and not exists (
            select 1
            from private.academic_non_instructional_class_dates no_class
            where no_class.class_number = prior.class_number
              and no_class.class_date =
                (prior.starts_at at time zone 'America/Sao_Paulo')::date
          )
        order by prior.starts_at desc$corrected$;
begin
  current_definition := pg_get_functiondef(
    'public.get_teacher_study_history_for_plan(date)'::regprocedure
  );

  if position(
    'private.academic_non_instructional_class_dates' in current_definition
  ) > 0 then
    return;
  end if;

  if position(original_filter in current_definition) = 0 then
    raise exception
      'Definicao inesperada de get_teacher_study_history_for_plan; hotfix cancelado.';
  end if;

  execute replace(current_definition, original_filter, corrected_filter);
end;
$hotfix$;

commit;

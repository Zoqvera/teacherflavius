-- Permite que o professor expanda o Roteiro de Estudos além dos 24 cards iniciais.
-- O valor transitório 0 solicita ao trigger a criação atômica do próximo card.

alter table public.study_lesson_pages
  drop constraint if exists study_lesson_pages_roadmap_lesson_number_check;

alter table public.study_lesson_pages
  add constraint study_lesson_pages_roadmap_lesson_number_check
  check (roadmap_lesson_number >= 1);

alter table public.study_roadmap_completion
  drop constraint if exists study_roadmap_completion_lesson_number_check;

alter table public.study_roadmap_completion
  add constraint study_roadmap_completion_lesson_number_check
  check (lesson_number >= 1);

create or replace function public.set_study_lesson_page_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  next_lesson_number smallint;
  current_lesson_number smallint;
begin
  if new.roadmap_lesson_number = 0 then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('study_lesson_pages:roadmap_card', 0)
    );

    current_lesson_number := case
      when tg_op = 'UPDATE' then old.roadmap_lesson_number
      else null
    end;

    select (
      greatest(
        24,
        coalesce(max(page.roadmap_lesson_number), 24),
        coalesce(current_lesson_number, 24)
      ) + 1
    )::smallint
    into next_lesson_number
    from public.study_lesson_pages page
    where tg_op <> 'UPDATE'
       or page.id <> old.id;

    new.roadmap_lesson_number = next_lesson_number;
  end if;

  if tg_op = 'INSERT' then
    new.created_by = (select auth.uid());
  end if;

  new.updated_by = (select auth.uid());
  new.updated_at = pg_catalog.now();
  return new;
end;
$function$;

revoke execute on function public.set_study_lesson_page_audit_fields()
  from public, anon, authenticated;

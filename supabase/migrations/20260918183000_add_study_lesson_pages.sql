-- Páginas de lição criadas manualmente pelo professor e vinculadas, de forma opcional,
-- aos 24 cards existentes do Roteiro de Estudos.

create table if not exists public.study_lesson_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(btrim(title)) between 1 and 200),
  objective text not null
    check (char_length(btrim(objective)) between 1 and 500),
  example text not null
    check (char_length(btrim(example)) between 1 and 1000),
  practical_exercise text not null
    check (char_length(btrim(practical_exercise)) between 1 and 500),
  useful_vocabulary text not null
    check (char_length(btrim(useful_vocabulary)) between 1 and 1000),
  roadmap_lesson_number smallint
    check (roadmap_lesson_number between 1 and 24),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists study_lesson_pages_roadmap_lesson_number_uidx
  on public.study_lesson_pages (roadmap_lesson_number)
  where roadmap_lesson_number is not null;

create or replace function public.set_study_lesson_page_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.created_by = (select auth.uid());
  end if;

  new.updated_by = (select auth.uid());
  new.updated_at = pg_catalog.now();
  return new;
end;
$function$;

drop trigger if exists set_study_lesson_page_audit_fields on public.study_lesson_pages;
create trigger set_study_lesson_page_audit_fields
before insert or update on public.study_lesson_pages
for each row
execute function public.set_study_lesson_page_audit_fields();

alter table public.study_lesson_pages enable row level security;

revoke all on table public.study_lesson_pages from anon, authenticated;
grant select, insert, update, delete on table public.study_lesson_pages to authenticated;

drop policy if exists "Alunos podem ver páginas de lição vinculadas" on public.study_lesson_pages;
create policy "Alunos podem ver páginas de lição vinculadas"
  on public.study_lesson_pages
  for select
  to authenticated
  using (
    roadmap_lesson_number is not null
    or (select public.is_teacher_admin_mfa())
  );

drop policy if exists "Professor pode criar páginas de lição" on public.study_lesson_pages;
create policy "Professor pode criar páginas de lição"
  on public.study_lesson_pages
  for insert
  to authenticated
  with check ((select public.is_teacher_admin_mfa()));

drop policy if exists "Professor pode atualizar páginas de lição" on public.study_lesson_pages;
create policy "Professor pode atualizar páginas de lição"
  on public.study_lesson_pages
  for update
  to authenticated
  using ((select public.is_teacher_admin_mfa()))
  with check ((select public.is_teacher_admin_mfa()));

drop policy if exists "Professor pode excluir páginas de lição" on public.study_lesson_pages;
create policy "Professor pode excluir páginas de lição"
  on public.study_lesson_pages
  for delete
  to authenticated
  using ((select public.is_teacher_admin_mfa()));

revoke execute on function public.set_study_lesson_page_audit_fields() from public, anon, authenticated;

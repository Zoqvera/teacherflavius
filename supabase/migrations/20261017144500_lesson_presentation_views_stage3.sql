-- ETAPA 3/5: recibo imutável de visualização por revisão da apresentação.
-- Aplicar somente após 20261017133000; produção permanece bloqueada.
-- Esta migração não altera autoria, corpo, revisão nem recibos anteriores.
do $requirements$
begin
  if to_regclass('public.lesson_presentations') is null
    or to_regclass('public.lesson_presentation_versions') is null
    or to_regprocedure('public.is_teacher_admin()') is null then
    raise exception 'A migração da etapa 1 e a autorização docente são obrigatórias.';
  end if;
end;
$requirements$;

create table public.lesson_presentation_views (
  presentation_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  constraint lesson_presentation_views_pkey
    primary key (presentation_id, revision_number, teacher_id),
  constraint lesson_presentation_views_version_fkey
    foreign key (presentation_id, revision_number)
    references public.lesson_presentation_versions (presentation_id, revision_number)
    on delete cascade
);

create index lesson_presentation_views_teacher_date_idx
  on public.lesson_presentation_views (teacher_id, viewed_at desc);

comment on table public.lesson_presentation_views is
  'Recibo por professor e revisão. Edições posteriores exigem nova visualização.';

alter table public.lesson_presentation_views enable row level security;

revoke all on public.lesson_presentation_views from public, anon, authenticated;
grant select on public.lesson_presentation_views to authenticated;
grant insert (presentation_id, revision_number, teacher_id)
  on public.lesson_presentation_views to authenticated;

create policy "Professor e autor consultam visualizações"
  on public.lesson_presentation_views
  for select to authenticated
  using (
    (select public.is_teacher_admin())
    or exists (
      select 1
      from public.lesson_presentations presentation
      where presentation.id = public.lesson_presentation_views.presentation_id
        and presentation.student_id = (select auth.uid())
    )
  );

create policy "Professor registra visualização da versão atual"
  on public.lesson_presentation_views
  for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and (select public.is_teacher_admin())
    and exists (
      select 1
      from public.lesson_presentations presentation
      where presentation.id = public.lesson_presentation_views.presentation_id
        and presentation.revision_number = public.lesson_presentation_views.revision_number
    )
  );

do $verify_receipts$
begin
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.lesson_presentation_views'::regclass
  ) then
    raise exception 'RLS é obrigatório para recibos.';
  end if;
  if has_table_privilege('anon', 'public.lesson_presentation_views', 'SELECT')
    or has_table_privilege('anon', 'public.lesson_presentation_views', 'INSERT')
    or has_table_privilege('authenticated', 'public.lesson_presentation_views', 'UPDATE')
    or has_table_privilege('authenticated', 'public.lesson_presentation_views', 'DELETE')
    or has_column_privilege(
      'authenticated', 'public.lesson_presentation_views', 'viewed_at', 'INSERT'
    ) then
    raise exception 'Permissões inseguras em recibos de visualização.';
  end if;
end;
$verify_receipts$;

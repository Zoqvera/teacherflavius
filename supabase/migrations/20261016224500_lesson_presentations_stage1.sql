-- ETAPA 1: armazenamento de apresentacoes por aluno e licao.
-- Sem alteracoes na interface ou nas paginas publicas.
-- Aplicar somente apos validacao isolada e reconciliacao do ledger de migrations.

create table public.lesson_presentations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  lesson_number integer check (lesson_number > 0),
  lesson_page_id uuid references public.study_lesson_pages(id) on delete restrict,
  lesson_key text generated always as (
    case
      when lesson_number is not null then 'lesson:' || lesson_number::text
      else 'page:' || lesson_page_id::text
    end
  ) stored,
  body text not null check (char_length(btrim(body)) between 1 and 15000),
  revision_number integer not null default 1 check (revision_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_presentation_requires_lesson
    check ((lesson_number is not null) <> (lesson_page_id is not null)),
  constraint lesson_presentations_student_lesson_unique
    unique (student_id, lesson_key)
);

create index lesson_presentations_student_updated_idx
  on public.lesson_presentations (student_id, updated_at desc);

comment on table public.lesson_presentations is
  'Versao atual da apresentacao do aluno, identificada pela licao numerada ou pela pagina de licao.';
comment on column public.lesson_presentations.lesson_key is
  'Identidade canonica. Para pagina vinculada ao roteiro, a identidade usa o numero da licao.';

create table public.lesson_presentation_versions (
  id bigint generated always as identity primary key,
  presentation_id uuid not null
    references public.lesson_presentations(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  body text not null check (char_length(btrim(body)) between 1 and 15000),
  saved_at timestamptz not null,
  constraint lesson_presentation_versions_revision_unique
    unique (presentation_id, revision_number)
);

comment on table public.lesson_presentation_versions is
  'Historico imutavel para clientes. Cada envio e edicao produz uma revisao.';

-- As colunas de propriedade, identidade e auditoria nao sao controladas pelo navegador.
create function private.guard_lesson_presentation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or new.student_id is distinct from (select auth.uid()) then
    raise exception 'A apresentacao deve pertencer ao aluno autenticado.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.body := btrim(new.body);
    new.revision_number := 1;
    new.created_at := now();
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.student_id is distinct from old.student_id
     or new.lesson_number is distinct from old.lesson_number
     or new.lesson_page_id is distinct from old.lesson_page_id
     or new.revision_number is distinct from old.revision_number
     or new.created_at is distinct from old.created_at
     or new.updated_at is distinct from old.updated_at then
    raise exception 'Somente o texto da apresentacao pode ser editado.'
      using errcode = '42501';
  end if;

  new.body := btrim(new.body);
  if new.body is not distinct from old.body then
    return old;
  end if;

  new.revision_number := old.revision_number + 1;
  new.updated_at := now();
  return new;
end;
$function$;

create trigger guard_lesson_presentation_write
before insert or update on public.lesson_presentations
for each row execute function private.guard_lesson_presentation_write();

-- O historico so pode ser gravado pelo gatilho, nunca diretamente por clientes.
create function private.record_lesson_presentation_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- A funcao e invocada apenas pelo trigger, mas confirma a autoria.
  if (select auth.uid()) is distinct from new.student_id then
    raise exception 'A revisao nao corresponde ao aluno autenticado.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and new.revision_number is not distinct from old.revision_number then
    return new;
  end if;

  insert into public.lesson_presentation_versions
    (presentation_id, revision_number, body, saved_at)
  values
    (new.id, new.revision_number, new.body, new.updated_at);

  return new;
end;
$function$;

create trigger record_lesson_presentation_version
after insert or update on public.lesson_presentations
for each row execute function private.record_lesson_presentation_version();

revoke all on function private.guard_lesson_presentation_write() from public, anon, authenticated;
revoke all on function private.record_lesson_presentation_version() from public, anon, authenticated;

alter table public.lesson_presentations enable row level security;
alter table public.lesson_presentation_versions enable row level security;

revoke all on table public.lesson_presentations from anon, authenticated;
revoke all on table public.lesson_presentation_versions from anon, authenticated;
grant select, insert, update on public.lesson_presentations to authenticated;
grant select on public.lesson_presentation_versions to authenticated;

create policy "Aluno e professor consultam apresentacoes"
on public.lesson_presentations for select to authenticated
using (
  student_id = (select auth.uid())
  or (select public.is_teacher_admin())
);

create policy "Aluno envia sua apresentacao"
on public.lesson_presentations for insert to authenticated
with check (student_id = (select auth.uid()));

create policy "Aluno edita sua apresentacao"
on public.lesson_presentations for update to authenticated
using (student_id = (select auth.uid()))
with check (student_id = (select auth.uid()));

create policy "Aluno e professor consultam historico"
on public.lesson_presentation_versions for select to authenticated
using (
  exists (
    select 1 from public.lesson_presentations presentation
    where presentation.id = presentation_id
      and (
        presentation.student_id = (select auth.uid())
        or (select public.is_teacher_admin())
      )
  )
);

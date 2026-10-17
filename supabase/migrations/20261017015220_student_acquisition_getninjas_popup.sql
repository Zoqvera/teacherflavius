-- Permite registrar a primeira origem declarada após a matrícula, sem reescrever respostas.
-- GetNinjas utiliza o mesmo catálogo de origens de alunos e interessados.
alter table private.student_acquisition
  drop constraint if exists student_origin_allowed;
alter table private.student_acquisition
  add constraint student_origin_allowed check (
    declared_source is null or
    declared_source in ('instagram','chatgpt','google','referral','facebook','getninjas','other','unknown')
  );

alter table private.promotion_reservations
  drop constraint if exists promotion_origin_allowed;
alter table private.promotion_reservations
  add constraint promotion_origin_allowed check (
    declared_source is null or
    declared_source in ('instagram','chatgpt','google','referral','facebook','getninjas','other','unknown')
  );

alter table private.trial_lesson_appointments
  drop constraint if exists trial_origin_allowed;
alter table private.trial_lesson_appointments
  add constraint trial_origin_allowed check (
    declared_source is null or
    declared_source in ('instagram','chatgpt','google','referral','facebook','getninjas','other','unknown')
  );

create or replace function private.validate_acquisition_origin(p_source text, p_detail text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_source is not null
    and p_source not in ('instagram','chatgpt','google','referral','facebook','getninjas','other','unknown') then
    raise exception 'Origem inválida.' using errcode='22023';
  end if;
  if char_length(coalesce(p_detail,'')) > 120
    or (p_source='other' and nullif(btrim(coalesce(p_detail,'')),'') is null) then
    raise exception 'Descreva a origem (até 120 caracteres).' using errcode='22023';
  end if;
end;
$$;

-- Este RPC só grava a primeira resposta do próprio aluno matriculado.
-- Não altera a função usada durante a conclusão do cadastro, nem a edição pelo professor.
create or replace function public.submit_my_student_acquisition(
  target_source text, target_detail text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_student public.profiles%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Faça login.' using errcode='42501';
  end if;

  select * into current_student
  from public.profiles
  where id = (select auth.uid())
  for update;

  if not found
    or current_student.enrolled is distinct from true
    or coalesce(current_student.archived, false) then
    raise exception 'Esta pesquisa é exclusiva para alunos matriculados ativos.' using errcode='42501';
  end if;

  if nullif(btrim(coalesce(target_source,'')),'') is null then
    raise exception 'Selecione como conheceu as aulas.' using errcode='22023';
  end if;

  perform private.validate_acquisition_origin(target_source, target_detail);

  if exists (
    select 1 from private.student_acquisition
    where student_id = current_student.id and declared_source is not null
  ) then
    return false;
  end if;

  perform private.save_student_acquisition(
    current_student.id, target_source, target_detail, 'student', null
  );
  return true;
end;
$$;

revoke all on function public.submit_my_student_acquisition(text,text) from public, anon;
grant execute on function public.submit_my_student_acquisition(text,text) to authenticated;

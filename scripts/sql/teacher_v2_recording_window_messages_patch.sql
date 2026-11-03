-- Correção seletiva do aviso de janela de registro do Roteiro da Aula v2.
-- A RPC distingue a aula ainda não iniciada do registro efetivamente encerrado.
-- Preserva a trava compartilhada com o finalizador, a autorização e os limites
-- de 30 minutos antes até 90 minutos depois do início.
-- Uso: aplicar apenas esta função; NÃO executar db push de migrações históricas.

create or replace function private.assert_teacher_v2_session_open(
  target_lesson_kind text, target_entry_id uuid, target_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  lesson record;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_lesson_kind not in ('regular', 'makeup')
     or target_entry_id is null or target_date is null then
    raise exception 'Aula inválida.' using errcode = '22023';
  end if;

  -- Lock shared with the automatic finalizer prevents registration/closure races.
  perform pg_catalog.pg_advisory_xact_lock(20261022, 4);

  select * into lesson from private.resolve_academic_lesson(
    target_lesson_kind, target_entry_id, target_date
  );
  if lesson.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  if now() < lesson.starts_at - interval '30 minutes' then
    raise exception 'O registro ainda não foi liberado. A janela abre às % (horário de Brasília).',
      to_char(
        (lesson.starts_at - interval '30 minutes') at time zone 'America/Sao_Paulo',
        'HH24:MI'
      );
  end if;

  if now() >= lesson.starts_at + interval '90 minutes' then
    raise exception 'Janela de registro encerrada. Utilize a correção administrativa.';
  end if;

  if exists (
    select 1 from private.academic_class_session_finalizations closed
    where closed.class_number = lesson.class_number
      and closed.starts_at = lesson.starts_at
  ) then
    raise exception 'Aula já encerrada. Utilize a correção administrativa.';
  end if;
end;
$function$;

revoke all on function private.assert_teacher_v2_session_open(text, uuid, date)
  from public, anon, authenticated;
grant execute on function private.assert_teacher_v2_session_open(text, uuid, date)
  to service_role;

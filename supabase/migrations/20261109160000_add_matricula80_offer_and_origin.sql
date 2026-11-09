-- Oferta pública de matrícula R$ 80 / mês para turmas de até cinco alunos.
-- Mantém as condições comerciais e a atribuição de origem no servidor.

insert into private.enrollment_invite_links (
  seed_key,
  label,
  monthly_fee,
  classes_per_month,
  class_mode,
  active
)
values (
  'matricula80',
  'Turma de cinco alunos - quatro aulas por mês',
  80.00,
  4,
  'group',
  true
)
on conflict (seed_key) do nothing;

create or replace function public.authorize_my_matricula80()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requester_id uuid := auth.uid();
  promotion private.enrollment_invite_links%rowtype;
  authorization jsonb;
  authorized_link_id uuid;
begin
  if requester_id is null then
    raise exception 'Entre com sua conta Google para continuar.'
      using errcode = '42501';
  end if;

  select link.*
    into promotion
  from private.enrollment_invite_links link
  where link.seed_key = 'matricula80'
    and link.active = true;

  if promotion.id is null then
    raise exception 'Esta oferta de matrícula está temporariamente indisponível.'
      using errcode = '42501';
  end if;

  -- Reaproveita as validações existentes: Google, aluno novo, bloqueios e vínculo único.
  authorization := public.authorize_my_enrollment_link(promotion.token);
  if coalesce((authorization ->> 'ok')::boolean, false) is not true then
    return authorization;
  end if;

  select access.invite_link_id
    into authorized_link_id
  from private.student_enrollment_access access
  where access.user_id = requester_id
    and access.authorized_at is not null;

  if authorized_link_id is distinct from promotion.id then
    raise exception 'Esta conta já possui outra oferta de matrícula autorizada.'
      using errcode = '42501';
  end if;

  -- A origem é determinada pelo link validado no servidor, não pelo formulário.
  perform private.save_student_acquisition(
    requester_id,
    'anúncio80',
    null,
    'student',
    '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true,
    'class_mode', promotion.class_mode,
    'monthly_fee', promotion.monthly_fee,
    'classes_per_month', promotion.classes_per_month,
    'origin', 'anúncio80'
  );
end;
$function$;

revoke all on function public.authorize_my_matricula80() from public, anon;
grant execute on function public.authorize_my_matricula80() to authenticated;

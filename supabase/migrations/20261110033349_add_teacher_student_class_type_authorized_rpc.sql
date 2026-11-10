-- Additive compatibility stage: introduce an admin-only RPC before restricting
-- column-level UPDATE grants on public.profiles.
create or replace function public.set_teacher_student_profile_class_type(
  target_student_id uuid,
  target_class_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_class_type text := nullif(upper(btrim(coalesce(target_class_type, ''))), '');
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.'
      using errcode = '42501';
  end if;

  if target_student_id is null
     or normalized_class_type is not null
        and normalized_class_type not in ('INDIVIDUAL', 'QUINTETO') then
    raise exception 'Identificação do aluno ou tipo de turma inválido.'
      using errcode = '22023';
  end if;

  update public.profiles profile
     set class_type = normalized_class_type
   where profile.id = target_student_id
     and not exists (
       select 1
       from public.teacher_admins teacher
       where teacher.user_id = profile.id
     );

  if not found then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', target_student_id,
    'class_type', normalized_class_type
  );
end;
$function$;

revoke all on function public.set_teacher_student_profile_class_type(uuid, text)
from public, anon, authenticated;
grant execute on function public.set_teacher_student_profile_class_type(uuid, text)
to authenticated;

-- Save the enrollment lesson type through a narrow per-user operation.
-- This bypasses the protected-profile trigger only after enrollment access is authorized.

create or replace function public.set_my_enrollment_class_mode(target_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  normalized_mode text := lower(btrim(coalesce(target_mode, '')));
  target_class_type text;
begin
  if caller_id is null then
    raise exception 'Faça login para informar o tipo de aula.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  if coalesce(profile_row.enrolled, false)
     or coalesce(profile_row.profile_completed, false) then
    raise exception 'O tipo de aula da matrícula só pode ser escolhido antes da conclusão do cadastro.';
  end if;

  if not exists (
    select 1
    from private.student_enrollment_access access
    where access.user_id = caller_id
      and access.authorized_at is not null
  ) then
    raise exception 'Valide o código de acesso à matrícula antes de continuar.' using errcode = '42501';
  end if;

  target_class_type := case normalized_mode
    when 'group' then 'QUINTETO'
    when 'individual' then 'INDIVIDUAL'
    else null
  end;

  if target_class_type is null then
    raise exception 'Informe se você fará aulas individuais ou em grupo.';
  end if;

  update public.profiles
  set class_type = target_class_type
  where id = caller_id;

  return jsonb_build_object(
    'ok', true,
    'mode', normalized_mode,
    'class_type', target_class_type
  );
end;
$function$;

revoke execute on function public.set_my_enrollment_class_mode(text)
  from public, anon;
grant execute on function public.set_my_enrollment_class_mode(text)
  to authenticated;

notify pgrst, 'reload schema';

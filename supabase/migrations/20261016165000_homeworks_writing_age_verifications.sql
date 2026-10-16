-- ETAPA 5 — eligibility for external Writing processing.
-- Age clearance comes only from an authenticated teacher with MFA.
-- An editable student profile must never authorize third-party processing.
create table public.homework_writing_age_verifications (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  verified_adult boolean not null default false,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now()
);
alter table public.homework_writing_age_verifications enable row level security;
revoke all on public.homework_writing_age_verifications from public, anon, authenticated;
grant select, insert, update, delete on public.homework_writing_age_verifications to service_role;

comment on table public.homework_writing_age_verifications is
  'MFA-attested administrative eligibility for external Writing evaluation. '
  'False or missing means no provider call; never derived from user-editable DOB.';

create function public.homework_confirm_writing_age(
  p_student_id uuid, p_verified_adult boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $body$
declare
  student_exists boolean;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação reforçada do professor obrigatória.'
      using errcode = '42501';
  end if;
  if p_student_id is null or p_verified_adult is null then
    raise exception 'Confirmação etária inválida.' using errcode = '22023';
  end if;
  select exists(select 1 from public.profiles p
    where p.id=p_student_id and p.enrolled is true) into student_exists;
  if not student_exists then
    raise exception 'Aluno matriculado não encontrado.' using errcode = '22023';
  end if;
  if exists(select 1 from public.teacher_admins t where t.user_id=p_student_id) then
    raise exception 'Conta do professor não é aluno.' using errcode = '22023';
  end if;

  insert into public.homework_writing_age_verifications
    (student_id, verified_adult, confirmed_by, confirmed_at)
  values (p_student_id, p_verified_adult, (select auth.uid()), now())
  on conflict (student_id) do update
    set verified_adult = excluded.verified_adult,
        confirmed_by = excluded.confirmed_by,
        confirmed_at = excluded.confirmed_at;

  return jsonb_build_object(
    'student_id', p_student_id,
    'verified_adult', p_verified_adult,
    'automatic_release', false
  );
end;
$body$;

revoke all on function public.homework_confirm_writing_age(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.homework_confirm_writing_age(uuid,boolean)
  to authenticated;

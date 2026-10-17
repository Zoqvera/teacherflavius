-- Stage 3/5: synthetic, transactional role checks for presentation view receipts.
-- Run ONLY in a disposable Supabase CLI database after migrations 1 and 3.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000'::uuid,
  case n
    when 1 then '11111111-1111-4111-8111-111111111111'::uuid
    when 2 then '22222222-2222-4222-8222-222222222222'::uuid
    when 3 then '33333333-3333-4333-8333-333333333333'::uuid
    else '44444444-4444-4444-8444-444444444444'::uuid end,
  'authenticated', 'authenticated',
  'lesson-stage3-' || n || '@invalid.test',
  '', now(), now(), now()
from generate_series(1, 4) n;

insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.teacher_admins (user_id, email)
values
  ('33333333-3333-4333-8333-333333333333', 'lesson-stage3-3@invalid.test'),
  ('44444444-4444-4444-8444-444444444444', 'lesson-stage3-4@invalid.test');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into public.lesson_presentations(student_id, lesson_number, body)
values ('11111111-1111-4111-8111-111111111111', 12, 'Apresentação sintética original.');

do $student_cannot_mark_view$
declare
  presentation_uuid uuid;
begin
  select id into presentation_uuid
  from public.lesson_presentations
  where student_id = auth.uid() and lesson_key = 'lesson:12';

  begin
    insert into public.lesson_presentation_views
      (presentation_id, revision_number, teacher_id)
    values (presentation_uuid, 1, auth.uid());
    raise exception 'Um aluno registrou visualização docente.';
  exception when insufficient_privilege or check_violation then null; end;
end;
$student_cannot_mark_view$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

do $teacher_receipts$
declare
  presentation_uuid uuid;
begin
  if not public.is_teacher_admin() then
    raise exception 'A identidade docente sintética não foi reconhecida.';
  end if;
  select id into presentation_uuid
  from public.lesson_presentations
  where student_id = '11111111-1111-4111-8111-111111111111'
    and lesson_key = 'lesson:12';

  insert into public.lesson_presentation_views
    (presentation_id, revision_number, teacher_id)
  values (presentation_uuid, 1, auth.uid());

  if (select count(*) from public.lesson_presentation_views
      where presentation_id = presentation_uuid and revision_number = 1) <> 1 then
    raise exception 'O recibo da primeira revisão não foi persistido.';
  end if;

  begin
    insert into public.lesson_presentation_views
      (presentation_id, revision_number, teacher_id, viewed_at)
    values (presentation_uuid, 1, auth.uid(), '2000-01-01'::timestamptz);
    raise exception 'O timestamp do recibo pode ser forjado.';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.lesson_presentation_views
      (presentation_id, revision_number, teacher_id)
    values (
      presentation_uuid, 1,
      '11111111-1111-4111-8111-111111111111'
    );
    raise exception 'O docente forjou outro visualizador.';
  exception when insufficient_privilege or check_violation then null; end;
end;
$teacher_receipts$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

update public.lesson_presentations set body = 'Segunda revisão sintética.'
where student_id = auth.uid() and lesson_key = 'lesson:12';

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

do $teacher_cannot_mark_stale_version$
declare presentation_uuid uuid;
begin
  select id into presentation_uuid
  from public.lesson_presentations
  where student_id = '11111111-1111-4111-8111-111111111111'
    and lesson_key = 'lesson:12';

  if (select revision_number from public.lesson_presentations
      where id = presentation_uuid) <> 2 then
    raise exception 'O texto sintético não gerou uma segunda revisão.';
  end if;

  -- A different authorized teacher did not mark revision 1 before the edit.
  -- The policy must reject a stale receipt, not merely a duplicate row.
  select set_config('request.jwt.claim.sub',
    '44444444-4444-4444-8444-444444444444', true);
  begin
    insert into public.lesson_presentation_views
      (presentation_id, revision_number, teacher_id)
    values (presentation_uuid, 1, auth.uid());
    raise exception 'Recibo da revisão antiga aceito.';
  exception when insufficient_privilege or check_violation then null; end;
  select set_config('request.jwt.claim.sub',
    '33333333-3333-4333-8333-333333333333', true);

  insert into public.lesson_presentation_views
    (presentation_id, revision_number, teacher_id)
  values (presentation_uuid, 2, auth.uid());

  if (select count(*) from public.lesson_presentation_views
      where presentation_id = presentation_uuid) <> 2 then
    raise exception 'Recibos de revisões distintas não foram preservados.';
  end if;

  begin
    update public.lesson_presentation_views set viewed_at = now()
    where presentation_id = presentation_uuid;
    raise exception 'O docente alterou o recibo imutável.';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.lesson_presentation_views
    where presentation_id = presentation_uuid;
    raise exception 'O docente excluiu um recibo imutável.';
  exception when insufficient_privilege then null; end;
end;
$teacher_cannot_mark_stale_version$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $other_student_cannot_read$
begin
  if (select count(*) from public.lesson_presentations) <> 0
     or (select count(*) from public.lesson_presentation_views) <> 0 then
    raise exception 'Outro aluno teve acesso a apresentações e recibos.';
  end if;
end;
$other_student_cannot_read$;

set local role anon;
do $anonymous_cannot_read$
begin
  begin
    perform count(*) from public.lesson_presentation_views;
    raise exception 'O papel anônimo leu recibos privados.';
  exception when insufficient_privilege then null; end;
end;
$anonymous_cannot_read$;

reset role;
select 'LESSON_PRESENTATIONS_STAGE3_RECEIPTS_PASSED' as verdict;
rollback;

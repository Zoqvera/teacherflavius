-- Student reviews, moderation and public testimonials.

create table if not exists private.student_class_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  display_name_mode text not null,
  lesson_type text not null,
  rating smallint not null,
  comment text not null,
  status text not null default 'pending',
  publication_consent_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  moderation_note text,
  updated_at timestamptz not null default now(),
  constraint student_class_reviews_student_unique unique (student_id),
  constraint student_class_reviews_display_name_mode_check
    check (display_name_mode in ('full', 'first_initial')),
  constraint student_class_reviews_lesson_type_check
    check (lesson_type in ('group', 'individual')),
  constraint student_class_reviews_rating_check
    check (rating between 1 and 5),
  constraint student_class_reviews_comment_check
    check (char_length(btrim(comment)) between 10 and 1000),
  constraint student_class_reviews_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint student_class_reviews_display_name_check
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint student_class_reviews_moderation_note_check
    check (moderation_note is null or char_length(moderation_note) <= 1000)
);

alter table private.student_class_reviews enable row level security;

create index if not exists student_class_reviews_public_lookup_idx
  on private.student_class_reviews (lesson_type, status, submitted_at desc);

create index if not exists student_class_reviews_status_submitted_idx
  on private.student_class_reviews (status, submitted_at desc);

revoke all on table private.student_class_reviews from public, anon, authenticated;
grant select, insert, update, delete on table private.student_class_reviews to service_role;

create or replace function public.get_my_student_review()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_name text;
  profile_email text;
  profile_class_type text;
  normalized_lesson_type text;
  review_payload jsonb;
begin
  if caller_id is null then
    raise exception 'Faça login para avaliar suas aulas.' using errcode = '42501';
  end if;

  select
    nullif(btrim(profile.name), ''),
    nullif(btrim(profile.email), ''),
    upper(btrim(coalesce(profile.class_type, '')))
  into profile_name, profile_email, profile_class_type
  from public.profiles profile
  where profile.id = caller_id
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;

  if not found then
    raise exception 'Esta página está disponível apenas para alunos ativos.' using errcode = '42501';
  end if;

  normalized_lesson_type := case profile_class_type
    when 'INDIVIDUAL' then 'individual'
    when 'QUINTETO' then 'group'
    else null
  end;

  if normalized_lesson_type is null then
    raise exception 'Seu tipo de aula ainda não está definido. Fale com o professor.';
  end if;

  select jsonb_build_object(
    'id', review.id,
    'display_name', review.display_name,
    'display_name_mode', review.display_name_mode,
    'lesson_type', review.lesson_type,
    'rating', review.rating,
    'comment', review.comment,
    'status', review.status,
    'publication_consent_at', review.publication_consent_at,
    'submitted_at', review.submitted_at,
    'approved_at', review.approved_at,
    'moderation_note', review.moderation_note
  )
  into review_payload
  from private.student_class_reviews review
  where review.student_id = caller_id;

  return jsonb_build_object(
    'student_name', coalesce(profile_name, split_part(coalesce(profile_email, 'Aluno'), '@', 1)),
    'lesson_type', normalized_lesson_type,
    'review', review_payload
  );
end;
$function$;

create or replace function public.submit_my_student_review(
  target_rating integer,
  target_comment text,
  target_display_name_mode text,
  target_publication_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_name text;
  profile_email text;
  profile_class_type text;
  normalized_name text;
  normalized_mode text := lower(btrim(coalesce(target_display_name_mode, '')));
  normalized_comment text := btrim(coalesce(target_comment, ''));
  normalized_lesson_type text;
  public_display_name text;
  saved_review private.student_class_reviews%rowtype;
begin
  if caller_id is null then
    raise exception 'Faça login para avaliar suas aulas.' using errcode = '42501';
  end if;

  select
    nullif(btrim(profile.name), ''),
    nullif(btrim(profile.email), ''),
    upper(btrim(coalesce(profile.class_type, '')))
  into profile_name, profile_email, profile_class_type
  from public.profiles profile
  where profile.id = caller_id
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;

  if not found then
    raise exception 'Apenas alunos ativos podem enviar uma avaliação.' using errcode = '42501';
  end if;

  if target_rating is null or target_rating not between 1 and 5 then
    raise exception 'Escolha uma nota de 1 a 5 estrelas.';
  end if;

  if char_length(normalized_comment) < 10 or char_length(normalized_comment) > 1000 then
    raise exception 'O comentário deve ter entre 10 e 1000 caracteres.';
  end if;

  if normalized_mode not in ('full', 'first_initial') then
    raise exception 'Escolha como seu nome será exibido.';
  end if;

  if coalesce(target_publication_consent, false) is not true then
    raise exception 'Autorize a publicação para enviar sua avaliação.';
  end if;

  normalized_lesson_type := case profile_class_type
    when 'INDIVIDUAL' then 'individual'
    when 'QUINTETO' then 'group'
    else null
  end;

  if normalized_lesson_type is null then
    raise exception 'Seu tipo de aula ainda não está definido. Fale com o professor.';
  end if;

  normalized_name := regexp_replace(
    coalesce(profile_name, split_part(coalesce(profile_email, 'Aluno'), '@', 1)),
    '\s+',
    ' ',
    'g'
  );

  if normalized_mode = 'first_initial' and position(' ' in normalized_name) > 0 then
    public_display_name :=
      split_part(normalized_name, ' ', 1)
      || ' '
      || upper(left(regexp_replace(normalized_name, '^.* ', ''), 1))
      || '.';
  else
    public_display_name := normalized_name;
  end if;

  insert into private.student_class_reviews (
    student_id,
    display_name,
    display_name_mode,
    lesson_type,
    rating,
    comment,
    status,
    publication_consent_at,
    submitted_at,
    approved_at,
    reviewed_at,
    reviewed_by,
    moderation_note,
    updated_at
  )
  values (
    caller_id,
    public_display_name,
    normalized_mode,
    normalized_lesson_type,
    target_rating::smallint,
    normalized_comment,
    'pending',
    now(),
    now(),
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (student_id) do update
  set
    display_name = excluded.display_name,
    display_name_mode = excluded.display_name_mode,
    lesson_type = excluded.lesson_type,
    rating = excluded.rating,
    comment = excluded.comment,
    status = 'pending',
    publication_consent_at = now(),
    submitted_at = now(),
    approved_at = null,
    reviewed_at = null,
    reviewed_by = null,
    moderation_note = null,
    updated_at = now()
  returning * into saved_review;

  return jsonb_build_object(
    'ok', true,
    'id', saved_review.id,
    'display_name', saved_review.display_name,
    'lesson_type', saved_review.lesson_type,
    'rating', saved_review.rating,
    'comment', saved_review.comment,
    'status', saved_review.status,
    'submitted_at', saved_review.submitted_at
  );
end;
$function$;

create or replace function public.delete_my_student_review()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  deleted_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para retirar sua avaliação.' using errcode = '42501';
  end if;

  delete from private.student_class_reviews review
  where review.student_id = caller_id;

  get diagnostics deleted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted', deleted_count > 0
  );
end;
$function$;

create or replace function public.get_public_student_reviews(target_lesson_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_lesson_type text := lower(btrim(coalesce(target_lesson_type, '')));
  average_rating numeric(3,2);
  total_reviews integer := 0;
  recent_reviews jsonb := '[]'::jsonb;
begin
  if normalized_lesson_type not in ('group', 'individual') then
    raise exception 'Tipo de aula inválido.' using errcode = '22023';
  end if;

  select
    round(avg(review.rating)::numeric, 2),
    count(*)::integer
  into average_rating, total_reviews
  from private.student_class_reviews review
  where review.lesson_type = normalized_lesson_type
    and review.status = 'approved'
    and review.publication_consent_at is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'display_name', recent.display_name,
        'rating', recent.rating,
        'comment', recent.comment,
        'submitted_at', recent.submitted_at,
        'verified_student', true
      )
      order by recent.submitted_at desc, recent.id desc
    ),
    '[]'::jsonb
  )
  into recent_reviews
  from (
    select review.id, review.display_name, review.rating, review.comment, review.submitted_at
    from private.student_class_reviews review
    where review.lesson_type = normalized_lesson_type
      and review.status = 'approved'
      and review.publication_consent_at is not null
    order by review.submitted_at desc, review.id desc
    limit 5
  ) recent;

  return jsonb_build_object(
    'lesson_type', normalized_lesson_type,
    'average_rating', coalesce(average_rating, 0),
    'total_reviews', total_reviews,
    'reviews', recent_reviews
  );
end;
$function$;

create or replace function public.get_teacher_student_reviews(target_status text default null)
returns table (
  review_id uuid,
  student_id uuid,
  student_name text,
  display_name text,
  lesson_type text,
  rating smallint,
  comment text,
  status text,
  publication_consent_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  reviewed_at timestamptz,
  moderation_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_status text := nullif(lower(btrim(coalesce(target_status, ''))), '');
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if normalized_status is not null
     and normalized_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Status de avaliação inválido.' using errcode = '22023';
  end if;

  return query
  select
    review.id,
    review.student_id,
    coalesce(nullif(btrim(profile.name), ''), nullif(btrim(profile.email), ''), 'Aluno')::text,
    review.display_name,
    review.lesson_type,
    review.rating,
    review.comment,
    review.status,
    review.publication_consent_at,
    review.submitted_at,
    review.approved_at,
    review.reviewed_at,
    review.moderation_note
  from private.student_class_reviews review
  left join public.profiles profile on profile.id = review.student_id
  where normalized_status is null or review.status = normalized_status
  order by
    case review.status when 'pending' then 0 when 'approved' then 1 else 2 end,
    review.submitted_at desc,
    review.id desc;
end;
$function$;

create or replace function public.moderate_teacher_student_review(
  target_review_id uuid,
  target_status text,
  target_moderation_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_status text := lower(btrim(coalesce(target_status, '')));
  normalized_note text := nullif(btrim(coalesce(target_moderation_note, '')), '');
  saved_review private.student_class_reviews%rowtype;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_review_id is null then
    raise exception 'Avaliação inválida.' using errcode = '22023';
  end if;

  if normalized_status not in ('approved', 'rejected') then
    raise exception 'Use approved ou rejected para moderar a avaliação.' using errcode = '22023';
  end if;

  if normalized_note is not null and char_length(normalized_note) > 1000 then
    raise exception 'A observação de moderação deve ter no máximo 1000 caracteres.';
  end if;

  update private.student_class_reviews review
  set
    status = normalized_status,
    approved_at = case when normalized_status = 'approved' then now() else null end,
    reviewed_at = now(),
    reviewed_by = auth.uid(),
    moderation_note = normalized_note,
    updated_at = now()
  where review.id = target_review_id
  returning * into saved_review;

  if not found then
    raise exception 'Avaliação não encontrada.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', saved_review.id,
    'status', saved_review.status,
    'approved_at', saved_review.approved_at,
    'reviewed_at', saved_review.reviewed_at
  );
end;
$function$;

revoke execute on function public.get_my_student_review() from public, anon;
grant execute on function public.get_my_student_review() to authenticated, service_role;

revoke execute on function public.submit_my_student_review(integer, text, text, boolean) from public, anon;
grant execute on function public.submit_my_student_review(integer, text, text, boolean) to authenticated, service_role;

revoke execute on function public.delete_my_student_review() from public, anon;
grant execute on function public.delete_my_student_review() to authenticated, service_role;

revoke execute on function public.get_public_student_reviews(text) from public;
grant execute on function public.get_public_student_reviews(text) to anon, authenticated, service_role;

revoke execute on function public.get_teacher_student_reviews(text) from public, anon;
grant execute on function public.get_teacher_student_reviews(text) to authenticated, service_role;

revoke execute on function public.moderate_teacher_student_review(uuid, text, text) from public, anon;
grant execute on function public.moderate_teacher_student_review(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

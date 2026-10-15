-- Privacy-preserving student review invitation funnel (one row per student).
-- No names, messages, IP addresses, or per-visit browsing logs are stored.
create table if not exists private.student_review_invitation_metrics (
  student_id uuid primary key references auth.users(id) on delete cascade,
  first_shown_at timestamptz,
  first_clicked_at timestamptz,
  first_dismissed_at timestamptz
);

alter table private.student_review_invitation_metrics enable row level security;
revoke all on table private.student_review_invitation_metrics from public, anon, authenticated;
grant select, insert, update, delete on table private.student_review_invitation_metrics to service_role;

create or replace function public.record_my_student_review_invitation(target_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  enrollment_date date;
  normalized_action text := lower(btrim(coalesce(target_action, '')));
begin
  if caller_id is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  if normalized_action not in ('shown', 'clicked', 'dismissed') then
    raise exception 'Evento de convite inválido.' using errcode = '22023';
  end if;

  select timezone('America/Sao_Paulo', coalesce(p.enrolled_at, p.created_at))::date
    into enrollment_date
  from public.profiles p
  where p.id = caller_id
    and p.enrolled is true
    and coalesce(p.archived, false) is false
    and upper(btrim(coalesce(p.class_type, ''))) in ('INDIVIDUAL', 'QUINTETO');

  if not found or enrollment_date is null
     or timezone('America/Sao_Paulo', now())::date <
        (enrollment_date + interval '2 months')::date then
    return false;
  end if;

  -- Never count a new invitation for a student who has already reviewed.
  if exists (
    select 1 from private.student_class_reviews r
    where r.student_id = caller_id
  ) then
    return false;
  end if;

  insert into private.student_review_invitation_metrics as metrics
    (student_id, first_shown_at, first_clicked_at, first_dismissed_at)
  values (
    caller_id,
    now(),
    case when normalized_action = 'clicked' then now() end,
    case when normalized_action = 'dismissed' then now() end
  )
  on conflict (student_id) do update set
    first_shown_at = coalesce(metrics.first_shown_at, excluded.first_shown_at),
    first_clicked_at = coalesce(metrics.first_clicked_at, excluded.first_clicked_at),
    first_dismissed_at = coalesce(metrics.first_dismissed_at, excluded.first_dismissed_at);

  return true;
end;
$function$;

revoke all on function public.record_my_student_review_invitation(text) from public, anon;
grant execute on function public.record_my_student_review_invitation(text) to authenticated, service_role;

create or replace function public.get_teacher_student_review_invitation_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  metrics jsonb;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  with eligible as (
    select p.id
    from public.profiles p
    where p.enrolled is true
      and coalesce(p.archived, false) is false
      and upper(btrim(coalesce(p.class_type, ''))) in ('INDIVIDUAL', 'QUINTETO')
      and coalesce(p.enrolled_at, p.created_at) is not null
      and (timezone('America/Sao_Paulo', coalesce(p.enrolled_at, p.created_at))::date
        + interval '2 months')::date <= timezone('America/Sao_Paulo', now())::date
  )
  select jsonb_build_object(
    'eligible_active', count(*),
    'already_reviewed', count(r.student_id),
    'awaiting_review', count(*) filter (where r.student_id is null),
    'shown', count(m.first_shown_at),
    'clicked', count(m.first_clicked_at),
    'dismissed', count(m.first_dismissed_at),
    'reviewed_after_invitation', count(*) filter (
      where m.first_shown_at is not null
        and r.submitted_at >= m.first_shown_at
    ),
    'updated_at', now()
  )
  into metrics
  from eligible e
  left join private.student_review_invitation_metrics m on m.student_id = e.id
  left join private.student_class_reviews r on r.student_id = e.id;

  return metrics;
end;
$function$;

revoke all on function public.get_teacher_student_review_invitation_metrics() from public, anon;
grant execute on function public.get_teacher_student_review_invitation_metrics() to authenticated, service_role;

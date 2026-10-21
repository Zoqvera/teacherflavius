create table if not exists private.teacher_administrative_enrollment_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','completed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  completed_at timestamptz,
  enrolled_student_id uuid references public.profiles(id),
  constraint teacher_admin_draft_completion_consistency check (
    (status='pending' and completed_at is null and enrolled_student_id is null)
    or (status='completed' and completed_at is not null and enrolled_student_id is not null)
  )
);
revoke all on private.teacher_administrative_enrollment_drafts
  from public,anon,authenticated;

create or replace function public.get_teacher_administrative_enrollment_draft(
  target_draft_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare draft private.teacher_administrative_enrollment_drafts%rowtype;
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.' using errcode='42501';
  end if;
  select * into draft from private.teacher_administrative_enrollment_drafts
  where id=target_draft_id;
  if not found then raise exception 'Solicitação de matrícula não encontrada.'; end if;
  if draft.status='pending' and draft.expires_at<now() then
    raise exception 'Esta solicitação de matrícula expirou.';
  end if;
  return jsonb_build_object(
    'id',draft.id,'status',draft.status,
    'payload',draft.payload,'student_id',draft.enrolled_student_id
  );
end;
$function$;
revoke all on function public.get_teacher_administrative_enrollment_draft(uuid)
 from public,anon;
grant execute on function public.get_teacher_administrative_enrollment_draft(uuid)
 to authenticated;

create or replace function public.complete_teacher_administrative_enrollment_draft(
  target_draft_id uuid, target_student_id uuid
)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare draft private.teacher_administrative_enrollment_drafts%rowtype;
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.' using errcode='42501';
  end if;
  select * into draft from private.teacher_administrative_enrollment_drafts
  where id=target_draft_id for update;
  if not found or draft.expires_at<now() then
    raise exception 'Solicitação não encontrada ou expirada.';
  end if;
  if draft.status='completed' then
    return draft.enrolled_student_id=target_student_id;
  end if;
  if not exists (
    select 1 from public.profiles p
    join private.administrative_weekly_plans plan
      on plan.student_id=p.id
    where p.id=target_student_id
      and p.access_mode='administrative'
      and lower(p.name)=lower(draft.payload->>'name')
      and regexp_replace(coalesce(p.whatsapp,''),'[^0-9]','','g')
        = regexp_replace(coalesce(draft.payload->>'whatsapp',''),'[^0-9]','','g')
      and plan.weekly_fee=(draft.payload->>'weekly_fee')::numeric
  ) then raise exception 'A matrícula confirmada não corresponde à solicitação.'; end if;
  update private.teacher_administrative_enrollment_drafts
    set status='completed',completed_at=now(),enrolled_student_id=target_student_id
    where id=target_draft_id;
  return true;
end;
$function$;
revoke all on function public.complete_teacher_administrative_enrollment_draft(uuid,uuid)
 from public,anon;
grant execute on function public.complete_teacher_administrative_enrollment_draft(uuid,uuid)
 to authenticated;
notify pgrst,'reload schema';
-- Remove automatic origin/campaign attribution from /matricula50/.
-- The authorized invitation remains the sole identifier for this fee plan.
-- No existing student acquisition or campaign records are modified.

CREATE OR REPLACE FUNCTION public.authorize_my_matricula50()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requester_id uuid := auth.uid();
  promotion private.enrollment_invite_links%rowtype;
  authorization_result jsonb;
  authorized_link_id uuid;
begin
  if requester_id is null then
    raise exception 'Entre com sua conta Google para continuar.'
      using errcode = '42501';
  end if;

  select link.* into promotion
  from private.enrollment_invite_links link
  where link.seed_key = 'matricula50'
    and link.active = true;

  if promotion.id is null then
    raise exception 'Esta oferta de matrícula está temporariamente indisponível.'
      using errcode = '42501';
  end if;

  -- Reuse the existing Google, enrollment and one-invitation-only checks.
  authorization_result := public.authorize_my_enrollment_link(promotion.token);
  if coalesce((authorization_result ->> 'ok')::boolean, false) is not true then
    return authorization_result;
  end if;

  select access.invite_link_id into authorized_link_id
  from private.student_enrollment_access access
  where access.user_id = requester_id
    and access.authorized_at is not null;

  if authorized_link_id is distinct from promotion.id then
    raise exception 'Esta conta já possui outra oferta de matrícula autorizada.'
      using errcode = '42501';
  end if;

  -- The invitation defines the commercial terms, not the marketing source.
  return jsonb_build_object(
    'ok', true,
    'class_mode', promotion.class_mode,
    'monthly_fee', promotion.monthly_fee,
    'classes_per_month', promotion.classes_per_month
  );
end;
$function$
;
revoke all on function public.authorize_my_matricula50() from public, anon;
grant execute on function public.authorize_my_matricula50() to authenticated;

-- The first monthly tuition remains gated without marketing attribution.
CREATE OR REPLACE FUNCTION public.get_my_matricula80_payment_gate()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requester_id uuid := auth.uid();
  payment_required boolean;
begin
  if requester_id is null then
    raise exception 'Entre com sua conta Google para consultar a matrícula.'
      using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.profiles profile
    left join private.student_acquisition acquisition
      on acquisition.student_id = profile.id
    left join private.student_enrollment_access access
      on access.user_id = profile.id
      and access.authorized_at is not null
    left join private.enrollment_invite_links invite
      on invite.id = access.invite_link_id
    join public.student_billing_settings settings
      on settings.student_id = profile.id
    join public.monthly_tuition tuition
      on tuition.student_id = profile.id
      and tuition.reference_month =
        date_trunc('month', profile.tuition_first_due_date)::date
    where profile.id = requester_id
      and profile.enrolled = true
      and profile.archived = false
      and profile.profile_completed = true
      and profile.tuition_first_due_date is not null
      and tuition.payment_date is null
      and tuition.is_exempt = false
      and (
        (acquisition.declared_source = 'anúncio80'
         and settings.monthly_fee = 80.00)
        or
        (invite.seed_key = 'matricula50'
         and access.monthly_fee = 50.00
         and settings.monthly_fee = 50.00)
      )
  ) into payment_required;

  return jsonb_build_object('payment_required', payment_required);
end;
$function$
;
revoke all on function public.get_my_matricula80_payment_gate() from public, anon;
grant execute on function public.get_my_matricula80_payment_gate() to authenticated;

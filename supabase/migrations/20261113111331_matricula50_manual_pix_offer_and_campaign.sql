-- R$ 50 promotional enrollment: authenticated Google signup, manual first PIX,
-- and an explicit Meta campaign link while preserving Instagram as the origin.
do $preconditions$
begin
  if exists (
    select 1 from private.enrollment_invite_links
    where seed_key = 'matricula50'
      and (monthly_fee <> 50.00 or classes_per_month <> 4
           or class_mode <> 'group' or active is distinct from true)
  ) then
    raise exception 'A oferta matricula50 existente possui condições diferentes.';
  end if;

  if not exists (
    select 1 from private.marketing_campaign_aliases
    where alias = 'anuncio50'
      and meta_campaign_id = '120252326390770152'
      and advertised_monthly_price = 50.00
  ) then
    raise exception 'A campanha anuncio50 não corresponde à oferta de R$ 50.';
  end if;
end;
$preconditions$;

insert into private.enrollment_invite_links (
  seed_key, label, monthly_fee, classes_per_month, class_mode, active
)
values (
  'matricula50', 'Turma de cinco alunos - quatro aulas por mês',
  50.00, 4, 'group', true
)
on conflict (seed_key) do nothing;

create or replace function public.authorize_my_matricula50()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  -- The existing authorization service rejects enrolled/archived accounts,
  -- enforces Google identity, and protects one authorized offer per student.
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

  if not exists (
    select 1 from private.marketing_campaign_aliases
    where alias = 'anuncio50'
      and meta_campaign_id = '120252326390770152'
      and advertised_monthly_price = 50.00
  ) then
    raise exception 'A campanha de matrícula está temporariamente indisponível.'
      using errcode = '42501';
  end if;

  -- The Meta campaign and Instagram origin are fixed server-side.
  perform private.save_student_acquisition(
    requester_id,
    'instagram',
    null,
    'student',
    '{"utm_source":"instagram","utm_campaign":"anuncio50","enrollment_link":"matricula50"}'::jsonb
  );

  insert into private.marketing_campaign_confirmed_students (
    student_id, campaign_alias, evidence
  )
  values (requester_id, 'anuncio50', 'matricula50_link')
  on conflict (student_id) do nothing;

  if exists (
    select 1 from private.marketing_campaign_confirmed_students
    where student_id = requester_id and campaign_alias <> 'anuncio50'
  ) then
    raise exception 'Esta conta já está vinculada a outra campanha.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_mode', promotion.class_mode,
    'monthly_fee', promotion.monthly_fee,
    'classes_per_month', promotion.classes_per_month,
    'origin', 'instagram',
    'campaign_alias', 'anuncio50'
  );
end;
$function$;

revoke all on function public.authorize_my_matricula50() from public, anon;
grant execute on function public.authorize_my_matricula50() to authenticated;

-- Keep the historical RPC name used by auth guards and storage policies,
-- expanding its first-payment gate to the R$ 50 campaign.
create or replace function public.get_my_matricula80_payment_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
    join private.student_acquisition acquisition
      on acquisition.student_id = profile.id
    join public.student_billing_settings settings
      on settings.student_id = profile.id
    join public.monthly_tuition tuition
      on tuition.student_id = profile.id
      and tuition.reference_month =
        date_trunc('month', profile.tuition_first_due_date)::date
    left join private.marketing_campaign_confirmed_students confirmed
      on confirmed.student_id = profile.id
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
        (acquisition.declared_source = 'instagram'
         and confirmed.campaign_alias = 'anuncio50'
         and settings.monthly_fee = 50.00)
      )
  ) into payment_required;

  return jsonb_build_object('payment_required', payment_required);
end;
$function$;

revoke all on function public.get_my_matricula80_payment_gate() from public, anon;
grant execute on function public.get_my_matricula80_payment_gate() to authenticated;

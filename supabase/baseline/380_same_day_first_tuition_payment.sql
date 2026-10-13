-- New completed Google enrollments only; historical students keep their
-- recorded charges, contract days, reimbursements and access to payments.
alter table public.profiles
  add column if not exists first_payment_same_day_required boolean not null default false;

-- Server-authoritative enrollment-day and month-of-competence rules.
CREATE OR REPLACE FUNCTION private.get_enrollment_tuition_due_date_options(target_enrollment_date date)
 RETURNS date[]
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select array[
    target_enrollment_date
  ]::date[];
$function$


CREATE OR REPLACE FUNCTION public.set_my_tuition_due_date(target_due_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  enrollment_date date;
  due_date_options date[];
  chosen_first_due_date date;
  effective_due_day smallint;
  due_day_source text;
  system_start_month date;
  first_tuition_id uuid;
begin
  if caller_id is null then
    raise exception 'Faça login para escolher o vencimento.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  enrollment_date := timezone('America/Sao_Paulo', now())::date;

  if profile_row.tuition_due_day is not null
     and profile_row.tuition_first_due_date is not null then
    if target_due_date is null
       or target_due_date = profile_row.tuition_first_due_date then
      return jsonb_build_object(
        'ok', true,
        'due_day', profile_row.tuition_due_day,
        'first_due_date', profile_row.tuition_first_due_date,
        'billing_start_month',
          date_trunc('month', profile_row.tuition_first_due_date)::date,
        'already_selected', true,
        'auto_assigned', profile_row.tuition_due_day_source = 'system'
      );
    end if;

    raise exception 'O vencimento já foi escolhido para esta matrícula.';
  end if;

  due_date_options :=
    private.get_enrollment_tuition_due_date_options(enrollment_date);
  chosen_first_due_date := coalesce(target_due_date, enrollment_date);

  if chosen_first_due_date <> enrollment_date then
    raise exception 'O primeiro vencimento é definido automaticamente no dia da matrícula.';
  end if;

  effective_due_day := extract(day from chosen_first_due_date)::smallint;
  due_day_source :=
    case when target_due_date is null then 'system' else 'student' end;
  system_start_month := date_trunc('month', chosen_first_due_date)::date;

  update public.profiles
  set
    tuition_due_day = effective_due_day,
    tuition_due_day_anchor_date = enrollment_date,
    tuition_due_day_selected_at = now(),
    tuition_first_due_date = chosen_first_due_date,
    tuition_due_day_source = due_day_source
  where id = caller_id;

  update public.student_billing_settings
  set
    due_day = effective_due_day,
    billing_start_month = system_start_month,
    updated_at = now()
  where student_id = caller_id;

  first_tuition_id := private.ensure_first_tuition_for_student(
    caller_id,
    chosen_first_due_date
  );

  return jsonb_build_object(
    'ok', true,
    'due_day', effective_due_day,
    'first_due_date', chosen_first_due_date,
    'billing_start_month', system_start_month,
    'already_selected', false,
    'auto_assigned', target_due_date is null,
    'first_tuition_id', first_tuition_id
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.get_my_enrollment_onboarding_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  access_authorized boolean := false;
  flow_mode text;
begin
  if caller_id is null then
    raise exception 'Faça login para continuar a matrícula.'
      using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id;

  if profile_row.id is null then
    return jsonb_build_object(
      'mode', 'new_enrollment',
      'profile_exists', false,
      'profile_completed', false,
      'enrolled', false,
      'requires_access_code', true,
      'enrollment_access_authorized', false,
      'requires_class_mode', true,
      'requires_tuition_due_date', false,
      'requires_commercial_setup', true,
      'form_unlocked', false
    );
  end if;

  if coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno arquivado.'
      using errcode = '42501';
  end if;

  access_authorized := coalesce(public.has_my_enrollment_access(), false);

  flow_mode := case
    when coalesce(profile_row.profile_completed, false) then 'complete'
    when coalesce(profile_row.enrolled, false) then 'existing_student_profile_completion'
    else 'new_enrollment'
  end;

  return jsonb_build_object(
    'mode', flow_mode,
    'profile_exists', true,
    'profile_completed', coalesce(profile_row.profile_completed, false),
    'enrolled', coalesce(profile_row.enrolled, false),
    'requires_access_code', flow_mode = 'new_enrollment',
    'enrollment_access_authorized', access_authorized,
    'requires_class_mode', flow_mode = 'new_enrollment',
    'requires_tuition_due_date', false,
    'requires_commercial_setup', flow_mode = 'new_enrollment',
    'form_unlocked',
      flow_mode = 'existing_student_profile_completion'
      or (flow_mode = 'new_enrollment' and access_authorized)
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.activate_completed_google_student_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  provider_name text;
  candidate_code text;
  clean_cpf text;
  clean_whatsapp text;
  anchor_date date;
  automatic_first_due_date date;
  billing_monthly_fee numeric;
  billing_classes_per_month smallint;
  authorized_monthly_fee numeric(10, 2);
  authorized_classes_per_month smallint;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  select user_account.raw_app_meta_data ->> 'provider'
  into provider_name
  from auth.users user_account
  where user_account.id = new.id;

  if coalesce(new.profile_completed, false) = true
     and coalesce(new.enrolled, false) = false
     and provider_name = 'google'
     and not exists (
       select 1
       from public.teacher_admins admin
       where admin.user_id = new.id
          or lower(admin.email) = lower(coalesce(new.email, ''))
     )
  then
    select access.monthly_fee, access.classes_per_month
    into authorized_monthly_fee, authorized_classes_per_month
    from private.student_enrollment_access access
    where access.user_id = new.id
      and access.authorized_at is not null
      and access.monthly_fee is not null
      and access.classes_per_month is not null;

    if not found then
      raise exception 'Valide o código de acesso à matrícula antes de concluir o cadastro.'
        using errcode = '42501';
    end if;

    clean_cpf := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
    clean_whatsapp := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');

    if nullif(btrim(coalesce(new.name, '')), '') is null then
      raise exception 'Informe o nome completo para concluir a matrícula.';
    end if;

    if nullif(btrim(coalesce(new.email, '')), '') is null then
      raise exception 'A conta Google precisa ter um e-mail válido para concluir a matrícula.';
    end if;

    if new.date_of_birth is null then
      raise exception 'Informe a data de nascimento para concluir a matrícula.';
    end if;

    if length(clean_cpf) <> 11 then
      raise exception 'Informe um CPF válido com 11 dígitos para concluir a matrícula.';
    end if;

    if length(clean_whatsapp) < 10 then
      raise exception 'Informe um WhatsApp válido para concluir a matrícula.';
    end if;

    if new.class_type is null
       or new.class_type not in ('INDIVIDUAL', 'QUINTETO')
    then
      raise exception 'Informe se você fará aulas individuais ou em grupo para concluir a matrícula.';
    end if;

    select settings.monthly_fee, settings.classes_per_month
    into billing_monthly_fee, billing_classes_per_month
    from public.student_billing_settings settings
    where settings.student_id = new.id
      and settings.active = true;

    if not found
       or billing_monthly_fee is distinct from authorized_monthly_fee
       or billing_classes_per_month is distinct from authorized_classes_per_month
    then
      raise exception 'Os dados comerciais da matrícula não correspondem ao código de acesso validado.';
    end if;

    -- The enrollment transaction, not an earlier code validation, fixes the due date.
    anchor_date := timezone('America/Sao_Paulo', now())::date;
    automatic_first_due_date := anchor_date;

    new.tuition_due_day := extract(day from automatic_first_due_date)::smallint;
    new.tuition_due_day_anchor_date := anchor_date;
    new.tuition_due_day_selected_at := now();
    new.tuition_first_due_date := automatic_first_due_date;
    new.tuition_due_day_source := 'system';
    new.first_payment_same_day_required := true;

    update public.student_billing_settings settings
    set due_day = new.tuition_due_day,
        billing_start_month = date_trunc('month', automatic_first_due_date)::date,
        updated_at = now()
    where settings.student_id = new.id;

    new.enrolled := true;

    if nullif(btrim(new.enrollment_code), '') is null then
      loop
        candidate_code := upper(
          substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 5)
        );

        exit when not exists (
          select 1
          from public.profiles profile
          where profile.enrollment_code = candidate_code
            and profile.id <> new.id
        );
      end loop;

      new.enrollment_code := candidate_code;
    end if;

    if new.exercise_schedule_start_date is null then
      new.exercise_schedule_start_date :=
        (now() at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;

  return new;
end;
$function$


-- Prevent a student from disabling the cohort marker through a direct profile PATCH.
create or replace function private.protect_first_payment_policy()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  if auth.uid() is not null
     and auth.uid() = new.id
     and new.first_payment_same_day_required is distinct from old.first_payment_same_day_required
  then
    raise exception 'A política do pagamento inicial é controlada pelo sistema.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.protect_first_payment_policy()
  from public, anon, authenticated;

drop trigger if exists guard_first_payment_policy_from_student on public.profiles;
create trigger guard_first_payment_policy_from_student
before update of first_payment_same_day_required on public.profiles
for each row execute function private.protect_first_payment_policy();

-- No transaction initiated on a later local calendar date can create a
-- new first-tuition payment attempt. Previously opened provider payments
-- are deliberately not cancelled or reversed.
create or replace function private.is_first_tuition_payment_closed(target_tuition_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select coalesce((
    select profile.first_payment_same_day_required
      and tuition.payment_date is null
      and tuition.reference_month = billing.billing_start_month
      and tuition.due_date = profile.tuition_first_due_date
      and timezone('America/Sao_Paulo', now())::date > profile.tuition_first_due_date
    from public.monthly_tuition tuition
    join public.profiles profile on profile.id = tuition.student_id
    join public.student_billing_settings billing on billing.student_id = tuition.student_id
    where tuition.id = target_tuition_id
  ), false);
$function$;
revoke all on function private.is_first_tuition_payment_closed(uuid)
  from public, anon, authenticated;
grant execute on function private.is_first_tuition_payment_closed(uuid)
  to service_role;

create or replace function public.get_my_first_payment_window()
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  first_tuition_id uuid;
  first_due_date date;
  is_closed boolean := false;
begin
  if caller_id is null then
    raise exception 'Faça login para consultar o primeiro pagamento.'
      using errcode = '42501';
  end if;

  select tuition.id, profile.tuition_first_due_date
  into first_tuition_id, first_due_date
  from public.profiles profile
  join public.student_billing_settings billing on billing.student_id = profile.id
  join public.monthly_tuition tuition
    on tuition.student_id = profile.id
   and tuition.reference_month = billing.billing_start_month
  where profile.id = caller_id
    and profile.first_payment_same_day_required
    and tuition.payment_date is null
  limit 1;

  if first_tuition_id is not null then
    is_closed := private.is_first_tuition_payment_closed(first_tuition_id);
  end if;

  return jsonb_build_object(
    'tuition_id', first_tuition_id,
    'first_due_date', first_due_date,
    'closed', is_closed
  );
end;
$function$;
revoke all on function public.get_my_first_payment_window()
  from public, anon, authenticated;
grant execute on function public.get_my_first_payment_window()
  to authenticated, service_role;

-- PostgREST exposes public RPCs, not the private schema. This service-only
-- bridge keeps the deadline decision in PostgreSQL for the payment gateway.
create or replace function public.is_first_tuition_payment_closed(target_tuition_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select private.is_first_tuition_payment_closed(target_tuition_id);
$function$;
revoke all on function public.is_first_tuition_payment_closed(uuid)
  from public, anon, authenticated;
grant execute on function public.is_first_tuition_payment_closed(uuid)
  to service_role;

notify pgrst, 'reload schema';

-- Bind enrollment commercial terms to the server-side access code.
-- The Vault secret teacherflavius_enrollment_access_code stores a JSON object
-- keyed by access code. Secret values are provisioned out-of-band and never
-- committed to this repository.

alter table private.student_enrollment_access
  add column if not exists monthly_fee numeric(10, 2),
  add column if not exists classes_per_month smallint;

alter table private.student_enrollment_access
  add constraint student_enrollment_access_monthly_fee_positive
    check (monthly_fee is null or monthly_fee > 0),
  add constraint student_enrollment_access_classes_per_month_positive
    check (classes_per_month is null or classes_per_month > 0),
  add constraint student_enrollment_access_commercial_terms_pair
    check ((monthly_fee is null) = (classes_per_month is null));

-- Pending authorizations created under the previous generic-code model have no
-- trustworthy commercial terms. Require those students to validate a new code.
update private.student_enrollment_access access
set
  authorized_at = null,
  failed_attempts = 0,
  locked_until = null,
  monthly_fee = null,
  classes_per_month = null,
  updated_at = now()
from public.profiles profile
where profile.id = access.user_id
  and access.authorized_at is not null
  and not coalesce(profile.enrolled, false)
  and not coalesce(profile.profile_completed, false)
  and (access.monthly_fee is null or access.classes_per_month is null);

create or replace function public.has_my_enrollment_access()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    return false;
  end if;

  if coalesce(public.is_teacher_admin(), false) then
    return true;
  end if;

  return exists (
    select 1
    from private.student_enrollment_access access
    where access.user_id = requester_id
      and access.authorized_at is not null
      and access.monthly_fee is not null
      and access.classes_per_month is not null
  );
end;
$function$;

revoke all on function public.has_my_enrollment_access() from public, anon;
grant execute on function public.has_my_enrollment_access() to authenticated, service_role;

create or replace function public.authorize_my_enrollment(target_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requester_id uuid := auth.uid();
  provider_name text;
  secret_payload text;
  configured_plans jsonb;
  normalized_code text := btrim(coalesce(target_access_code, ''));
  selected_plan jsonb;
  access_row private.student_enrollment_access%rowtype;
  next_failed_attempts integer;
  new_locked_until timestamptz;
  authorized_monthly_fee numeric(10, 2);
  authorized_classes_per_month smallint;
begin
  if requester_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'authentication_required',
      'error', 'Sua sessão expirou. Entre novamente com Google.'
    );
  end if;

  select coalesce(user_account.raw_app_meta_data ->> 'provider', '')
  into provider_name
  from auth.users user_account
  where user_account.id = requester_id;

  if provider_name <> 'google'
     and not coalesce(public.is_teacher_admin(), false)
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'google_required',
      'error', 'Entre com sua conta Google para validar o código de matrícula.'
    );
  end if;

  insert into private.student_enrollment_access (user_id)
  values (requester_id)
  on conflict (user_id) do nothing;

  select access.*
  into access_row
  from private.student_enrollment_access access
  where access.user_id = requester_id
  for update;

  if access_row.authorized_at is not null
     and access_row.monthly_fee is not null
     and access_row.classes_per_month is not null
  then
    return jsonb_build_object(
      'ok', true,
      'already_authorized', true,
      'monthly_fee', access_row.monthly_fee,
      'classes_per_month', access_row.classes_per_month
    );
  end if;

  if access_row.locked_until is not null
     and access_row.locked_until > now()
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'temporarily_locked',
      'error', 'Muitas tentativas incorretas. Tente novamente em 15 minutos.'
    );
  end if;

  if access_row.locked_until is not null then
    update private.student_enrollment_access
    set
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
    where user_id = requester_id;

    access_row.failed_attempts := 0;
    access_row.locked_until := null;
  end if;

  select secret.decrypted_secret
  into secret_payload
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_enrollment_access_code'
  limit 1;

  if secret_payload is null then
    raise exception 'Os códigos de matrícula não estão configurados no servidor.';
  end if;

  begin
    configured_plans := secret_payload::jsonb;
  exception
    when others then
      raise exception 'A configuração de códigos de matrícula está inválida.';
  end;

  if jsonb_typeof(configured_plans) <> 'object' then
    raise exception 'A configuração de códigos de matrícula está inválida.';
  end if;

  if normalized_code <> ''
     and length(normalized_code) <= 64
  then
    selected_plan := configured_plans -> normalized_code;
  end if;

  if selected_plan is null then
    next_failed_attempts := access_row.failed_attempts + 1;

    if next_failed_attempts >= 5 then
      new_locked_until := now() + interval '15 minutes';

      update private.student_enrollment_access
      set
        authorized_at = null,
        monthly_fee = null,
        classes_per_month = null,
        failed_attempts = 0,
        locked_until = new_locked_until,
        updated_at = now()
      where user_id = requester_id;

      return jsonb_build_object(
        'ok', false,
        'code', 'temporarily_locked',
        'error', 'Muitas tentativas incorretas. Tente novamente em 15 minutos.'
      );
    end if;

    update private.student_enrollment_access
    set
      authorized_at = null,
      monthly_fee = null,
      classes_per_month = null,
      failed_attempts = next_failed_attempts,
      updated_at = now()
    where user_id = requester_id;

    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_code',
      'error', 'Código de matrícula inválido.'
    );
  end if;

  if jsonb_typeof(selected_plan) <> 'object' then
    raise exception 'A configuração de códigos de matrícula está inválida.';
  end if;

  begin
    authorized_monthly_fee :=
      round((selected_plan ->> 'monthly_fee')::numeric, 2);
    authorized_classes_per_month :=
      (selected_plan ->> 'classes_per_month')::smallint;
  exception
    when others then
      raise exception 'A configuração de códigos de matrícula está inválida.';
  end;

  if authorized_monthly_fee <= 0
     or authorized_classes_per_month <= 0
  then
    raise exception 'A configuração de códigos de matrícula está inválida.';
  end if;

  update private.student_enrollment_access
  set
    authorized_at = now(),
    monthly_fee = authorized_monthly_fee,
    classes_per_month = authorized_classes_per_month,
    failed_attempts = 0,
    locked_until = null,
    updated_at = now()
  where user_id = requester_id;

  return jsonb_build_object(
    'ok', true,
    'already_authorized', false,
    'monthly_fee', authorized_monthly_fee,
    'classes_per_month', authorized_classes_per_month
  );
end;
$function$;

revoke all on function public.authorize_my_enrollment(text) from public, anon;
grant execute on function public.authorize_my_enrollment(text) to authenticated, service_role;

-- target_monthly_fee remains as an optional compatibility argument for cached
-- clients. Its value is intentionally ignored; the authorized code is the only
-- commercial source of truth.
create or replace function public.set_my_enrollment_billing_terms(
  target_monthly_fee numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  anchor_date date;
  first_due_date date;
  effective_due_day smallint;
  start_month date;
  authorized_monthly_fee numeric(10, 2);
  authorized_classes_per_month smallint;
begin
  if caller_id is null then
    raise exception 'Faça login para informar os dados da matrícula.'
      using errcode = '42501';
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
     or coalesce(profile_row.profile_completed, false)
  then
    raise exception 'Os dados comerciais da matrícula só podem ser definidos antes da conclusão do cadastro.';
  end if;

  select access.monthly_fee, access.classes_per_month
  into authorized_monthly_fee, authorized_classes_per_month
  from private.student_enrollment_access access
  where access.user_id = caller_id
    and access.authorized_at is not null
    and access.monthly_fee is not null
    and access.classes_per_month is not null;

  if not found then
    raise exception 'Valide um código de matrícula com condições comerciais antes de continuar.'
      using errcode = '42501';
  end if;

  anchor_date := coalesce(
    profile_row.tuition_due_day_anchor_date,
    timezone('America/Sao_Paulo', now())::date
  );

  first_due_date := coalesce(
    profile_row.tuition_first_due_date,
    anchor_date
  );

  effective_due_day := coalesce(
    profile_row.tuition_due_day,
    extract(day from first_due_date)::smallint
  );

  start_month := date_trunc(
    'month',
    timezone('America/Sao_Paulo', now())::date
  )::date;

  insert into public.student_billing_settings (
    student_id,
    monthly_fee,
    due_day,
    billing_start_month,
    active,
    notes,
    updated_by,
    classes_per_month
  )
  values (
    caller_id,
    authorized_monthly_fee,
    effective_due_day,
    start_month,
    true,
    null,
    caller_id,
    authorized_classes_per_month
  )
  on conflict (student_id) do update
  set
    monthly_fee = excluded.monthly_fee,
    due_day = excluded.due_day,
    billing_start_month = excluded.billing_start_month,
    active = true,
    updated_at = now(),
    updated_by = caller_id,
    classes_per_month = excluded.classes_per_month;

  return jsonb_build_object(
    'ok', true,
    'classes_per_month', authorized_classes_per_month,
    'monthly_fee', authorized_monthly_fee,
    'due_day', effective_due_day,
    'billing_start_month', start_month
  );
end;
$function$;

revoke all on function public.set_my_enrollment_billing_terms(numeric)
  from public, anon;
grant execute on function public.set_my_enrollment_billing_terms(numeric)
  to authenticated, service_role;

create or replace function public.activate_completed_google_student_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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

    if new.tuition_due_day is null then
      anchor_date := coalesce(
        new.tuition_due_day_anchor_date,
        timezone('America/Sao_Paulo', now())::date
      );
      automatic_first_due_date := anchor_date;

      new.tuition_due_day := extract(day from automatic_first_due_date)::smallint;
      new.tuition_due_day_anchor_date := anchor_date;
      new.tuition_due_day_selected_at := now();
      new.tuition_first_due_date := automatic_first_due_date;
      new.tuition_due_day_source := 'system';

      update public.student_billing_settings settings
      set
        due_day = new.tuition_due_day,
        billing_start_month = date_trunc(
          'month',
          automatic_first_due_date
        )::date,
        updated_at = now()
      where settings.student_id = new.id;
    end if;

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
$function$;

notify pgrst, 'reload schema';

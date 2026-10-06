-- Recovery overlay for enrollment lesson-type selection.

-- Require new students to choose individual or group lessons during enrollment.
-- Group selection is stored as the existing QUINTETO classification.

comment on column public.profiles.class_type is
  'Tipo de aula do aluno. Novas matrículas escolhem INDIVIDUAL ou são classificadas automaticamente como QUINTETO quando escolhem aulas em grupo.';

create or replace function public.activate_completed_google_student_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
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
  expected_classes_per_month smallint;
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
     ) then
    if not exists (
      select 1
      from private.student_enrollment_access access
      where access.user_id = new.id
        and access.authorized_at is not null
    ) then
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
       or new.class_type not in ('INDIVIDUAL', 'QUINTETO') then
      raise exception 'Informe se você fará aulas individuais ou em grupo para concluir a matrícula.';
    end if;

    select settings.monthly_fee, settings.classes_per_month
    into billing_monthly_fee, billing_classes_per_month
    from public.student_billing_settings settings
    where settings.student_id = new.id
      and settings.active = true;

    expected_classes_per_month :=
      private.enrollment_classes_per_month_for_fee(billing_monthly_fee);

    if not found
       or expected_classes_per_month is null
       or billing_classes_per_month is distinct from expected_classes_per_month then
      raise exception 'Escolha um valor de mensalidade válido antes de concluir a matrícula.';
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
        candidate_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 5));
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
      new.exercise_schedule_start_date := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';

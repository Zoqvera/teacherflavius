-- Allow the optional WhatsApp promised by reserved-seat self-enrollment.
-- Access-code enrollment retains its previous mandatory-phone validation.
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

    -- A valid reserved-seat transaction may omit WhatsApp. All other
    -- enrollment paths retain their original phone requirement.
    if length(clean_whatsapp) < 10 and not (
      length(clean_whatsapp) = 0 and exists (
        select 1
        from private.student_enrollment_access access
        join private.class_seat_holds hold
          on hold.id = access.reserved_seat_hold_id
        where access.user_id = new.id
          and hold.student_id = new.id
          and hold.status = 'active'
          and hold.expires_at > now()
          and current_setting('teacherflavius.reserved_seat_completion', true) = hold.id::text
      )
    ) then
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_my_reserved_seat_enrollment(target_token text, target_name text, target_birth_date date, target_cpf text, target_whatsapp text, target_first_lesson_date date, target_source text, target_detail text DEFAULT NULL::text, target_technical jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  requester uuid := auth.uid();
  hold private.class_seat_holds%rowtype;
  course public.teacher_classes%rowtype;
  access private.student_enrollment_access%rowtype;
  link private.enrollment_invite_links%rowtype;
  profile public.profiles%rowtype;
  earliest_first_date date;
  chosen_date date;
  cpf_digits text := regexp_replace(coalesce(target_cpf,''),'\D','','g');
  phone_digits text := regexp_replace(coalesce(target_whatsapp,''),'\D','','g');
  clean_name text := btrim(coalesce(target_name,''));
  enrolled_profile public.profiles%rowtype;
begin
  if requester is null then
    raise exception 'Entre com Google para concluir a matrícula.' using errcode='42501';
  end if;
  if target_token is null or target_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Reserva inválida. Escolha novamente seu horário.' using errcode='22023';
  end if;

  select * into hold from private.class_seat_holds
  where token_digest=encode(extensions.digest(target_token,'sha256'),'hex');
  if not found then
    raise exception 'Reserva não encontrada. Escolha novamente seu horário.' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73008,hold.class_number);
  select * into hold from private.class_seat_holds where id=hold.id for update;
  if hold.status<>'active' or hold.expires_at<=now() then
    raise exception 'A reserva expirou. Escolha novamente um horário antes de concluir.' using errcode='23514';
  end if;
  if hold.student_id is distinct from requester then
    raise exception 'Entre com a mesma conta Google que iniciou esta matrícula.' using errcode='42501';
  end if;

  select * into course from public.teacher_classes
  where class_number=hold.class_number and is_active
    and class_type='quintet' and class_weekday between 1 and 7
    and class_start_time is not null;
  if not found then
    raise exception 'A turma escolhida não está disponível.' using errcode='23514';
  end if;

  if target_first_lesson_date is null or
     target_first_lesson_date>timezone('America/Sao_Paulo',now())::date+180 or
     extract(isodow from target_first_lesson_date)::integer<>course.class_weekday then
    raise exception 'Selecione uma data válida no dia da semana da turma.' using errcode='22023';
  end if;
  earliest_first_date := timezone('America/Sao_Paulo',now())::date;
  earliest_first_date := earliest_first_date
    + ((course.class_weekday::integer-extract(isodow from earliest_first_date)::integer+7)%7);
  if earliest_first_date=timezone('America/Sao_Paulo',now())::date then
    earliest_first_date:=earliest_first_date+7;
  end if;
  if course.first_lesson_date is not null and earliest_first_date<course.first_lesson_date then
    earliest_first_date:=course.first_lesson_date
      + ((course.class_weekday::integer-extract(isodow from course.first_lesson_date)::integer+7)%7);
  end if;
  if target_first_lesson_date<earliest_first_date then
    raise exception 'Escolha a primeira aula a partir de %.',to_char(earliest_first_date,'DD/MM/YYYY')
      using errcode='22023';
  end if;

  if length(clean_name) not between 2 and 120 or
     target_birth_date is null or target_birth_date<date '1900-01-01' or
     target_birth_date>timezone('America/Sao_Paulo',now())::date or
     length(cpf_digits)<>11 or
     (length(phone_digits)<>0 and length(phone_digits) not between 10 and 13) then
    raise exception 'Preencha nome, nascimento e CPF válidos. Se informar WhatsApp, use um número válido.'
      using errcode='22023';
  end if;

  select * into profile from public.profiles where id=requester for update;
  if not found or coalesce(profile.enrolled,false) or
     coalesce(profile.profile_completed,false) or coalesce(profile.archived,false) then
    raise exception 'Esta conta já possui uma matrícula. Consulte o professor.' using errcode='42501';
  end if;
  if exists(select 1 from public.class_students cs where cs.user_id=requester) then
    raise exception 'Este aluno já pertence a uma turma.' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u where u.id=requester
                and u.raw_app_meta_data->>'provider'='google') or
     coalesce(public.is_teacher_admin(),false) then
    raise exception 'A matrícula requer uma conta Google de aluno.' using errcode='42501';
  end if;

  select * into access from private.student_enrollment_access
  where user_id=requester and authorized_at is not null for update;
  select link.* into link from private.class_seat_enrollment_settings settings
  join private.enrollment_invite_links link on link.id=settings.invite_link_id
  where settings.singleton and link.active and link.class_mode='group';
  if access.user_id is null or link.id is null or
     access.invite_link_id is distinct from link.id or
     access.monthly_fee is distinct from link.monthly_fee or
     access.classes_per_month is distinct from link.classes_per_month or
     access.authorized_class_mode is distinct from 'group' then
    raise exception 'As condições comerciais mudaram. Consulte o professor.' using errcode='42501';
  end if;

  -- All of the following operations are one transaction. If the final
  -- class link fails, no enrollment, billing or source update survives.
  update public.profiles set date_of_birth=target_birth_date where id=requester;
  perform public.set_my_enrollment_class_mode('group');
  perform public.set_my_enrollment_billing_terms();
  perform public.set_my_student_acquisition(target_source,target_detail,target_technical);

  -- The profile trigger only permits activation from this reserved-seat RPC.
  perform pg_catalog.set_config('teacherflavius.reserved_seat_completion',hold.id::text,true);
  update public.profiles set
    name=clean_name,
    cpf=btrim(target_cpf),
    whatsapp=nullif(btrim(target_whatsapp),''),
    profile_completed=true
  where id=requester returning * into enrolled_profile;
  if not enrolled_profile.enrolled then
    raise exception 'Não foi possível ativar a matrícula. Nenhuma cobrança foi gerada.';
  end if;

  insert into public.class_students(class_number,user_id,first_lesson_date)
  values(hold.class_number,requester,target_first_lesson_date)
  returning first_lesson_date into chosen_date;

  if not exists(select 1 from private.class_seat_holds h
    where h.id=hold.id and h.status='claimed' and h.student_id=requester) then
    raise exception 'A reserva não foi confirmada. Tente novamente.' using errcode='23514';
  end if;

  return jsonb_build_object(
    'ok',true,'class_number',hold.class_number,
    'first_lesson_date',chosen_date,'monthly_fee',link.monthly_fee,
    'classes_per_month',link.classes_per_month,
    'payment_path','/pagamento/'
  );
end;
$function$;

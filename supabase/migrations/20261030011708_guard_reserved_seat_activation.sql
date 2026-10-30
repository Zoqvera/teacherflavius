-- Prevent expired held seats from becoming enrollment-access-code bypasses.
alter table private.student_enrollment_access
  add column reserved_seat_hold_id uuid references private.class_seat_holds(id);

create function private.guard_reserved_seat_profile_activation()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  seat_id uuid;
begin
  if tg_op='UPDATE' and not coalesce(old.profile_completed,false)
    and coalesce(new.profile_completed,false) then

    select access.reserved_seat_hold_id into seat_id
    from private.student_enrollment_access access
    where access.user_id=new.id;

    if seat_id is not null then
      if current_setting('teacherflavius.reserved_seat_completion',true)
         is distinct from seat_id::text then
        raise exception 'Conclua esta matrícula pelo formulário da turma reservada.'
          using errcode='42501';
      end if;

      if not exists (
        select 1 from private.class_seat_holds h
        where h.id=seat_id and h.student_id=new.id
          and h.status='active' and h.expires_at>now()
      ) then
        raise exception 'A reserva já expirou. Escolha novamente uma turma.'
          using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger zz_guard_reserved_seat_profile_activation
before update of profile_completed on public.profiles
for each row execute function private.guard_reserved_seat_profile_activation();

revoke all on function private.guard_reserved_seat_profile_activation()
  from public,anon,authenticated;

create or replace function public.authorize_my_reserved_seat_enrollment(target_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  requester uuid := auth.uid();
  hold private.class_seat_holds%rowtype;
  link private.enrollment_invite_links%rowtype;
  existing private.student_enrollment_access%rowtype;
  provider text;
  course public.teacher_classes%rowtype;
  earliest_first_date date;
begin
  if requester is null then
    raise exception 'Entre com sua conta Google para concluir a matrícula.' using errcode='42501';
  end if;

  select account.raw_app_meta_data->>'provider' into provider
  from auth.users account where account.id=requester;
  if provider is distinct from 'google' or coalesce(public.is_teacher_admin(),false) then
    raise exception 'Use uma conta Google de aluno para concluir a matrícula.' using errcode='42501';
  end if;

  if target_token is null or target_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Sua reserva não foi localizada.' using errcode='22023';
  end if;

  select * into hold from private.class_seat_holds
  where token_digest=encode(extensions.digest(target_token,'sha256'),'hex');
  if not found then
    raise exception 'Sua reserva não foi localizada.' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73008,hold.class_number);
  select * into hold from private.class_seat_holds
  where id=hold.id for update;
  if hold.status<>'active' or hold.expires_at<=now() then
    raise exception 'A reserva expirou. Escolha novamente um horário.' using errcode='23514';
  end if;
  if hold.student_id is not null and hold.student_id<>requester then
    raise exception 'Esta reserva já está associada a outra conta.' using errcode='42501';
  end if;

  if exists(select 1 from public.profiles p where p.id=requester
      and (coalesce(p.enrolled,false) or coalesce(p.profile_completed,false)
           or coalesce(p.archived,false))) then
    raise exception 'Esta conta já possui matrícula. Entre em contato para trocar de turma.' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles p where p.id=requester) then
    raise exception 'Seu cadastro não foi inicializado. Acesse novamente com Google.' using errcode='42501';
  end if;
  if exists(select 1 from public.class_students cs where cs.user_id=requester) then
    raise exception 'Esta conta já está vinculada a uma turma.' using errcode='42501';
  end if;

  select link.* into link
  from private.class_seat_enrollment_settings settings
  join private.enrollment_invite_links link on link.id=settings.invite_link_id
  where settings.singleton and link.active and link.class_mode='group'
  limit 1;
  if link.id is null then
    raise exception 'As condições de matrícula estão indisponíveis. Procure o professor.';
  end if;

  insert into private.student_enrollment_access(user_id) values(requester)
  on conflict(user_id) do nothing;
  select * into existing from private.student_enrollment_access
  where user_id=requester for update;

  if existing.authorized_at is not null
    and (existing.invite_link_id is distinct from link.id or
         existing.monthly_fee is distinct from link.monthly_fee or
         existing.classes_per_month is distinct from link.classes_per_month or
         existing.authorized_class_mode is distinct from 'group') then
    raise exception 'Sua conta já possui outras condições de matrícula. Entre em contato com o professor.'
      using errcode='42501';
  end if;

  if exists(select 1 from private.class_seat_holds h
    where h.student_id=requester and h.id<>hold.id and h.status='active'
      and h.expires_at>now()) then
    raise exception 'Você já possui outra reserva vinculada a esta conta.' using errcode='23514';
  end if;

  update private.student_enrollment_access set
    authorized_at=coalesce(authorized_at,now()),
    monthly_fee=link.monthly_fee,
    classes_per_month=link.classes_per_month,
    authorized_class_mode='group',
    invite_link_id=link.id,
    reserved_seat_hold_id=hold.id,
    failed_attempts=0,locked_until=null,updated_at=now()
  where user_id=requester;

  update private.class_seat_holds set student_id=requester,updated_at=now()
  where id=hold.id;

  select * into course from public.teacher_classes
  where class_number=hold.class_number and is_active and class_type='quintet';
  earliest_first_date:=timezone('America/Sao_Paulo',now())::date;
  earliest_first_date:=earliest_first_date
    + ((course.class_weekday::integer-extract(isodow from earliest_first_date)::integer+7)%7);
  if earliest_first_date=timezone('America/Sao_Paulo',now())::date then
    earliest_first_date:=earliest_first_date+7;
  end if;
  if course.first_lesson_date is not null and earliest_first_date<course.first_lesson_date then
    earliest_first_date:=course.first_lesson_date
      + ((course.class_weekday::integer-extract(isodow from course.first_lesson_date)::integer+7)%7);
  end if;

  return jsonb_build_object(
    'ok',true,'class_number',hold.class_number,
    'expires_at',hold.expires_at,'earliest_first_lesson_date',earliest_first_date,
    'monthly_fee',link.monthly_fee,
    'classes_per_month',link.classes_per_month
  );
end;
$$;


create or replace function public.complete_my_reserved_seat_enrollment(
  target_token text,
  target_name text,
  target_birth_date date,
  target_cpf text,
  target_whatsapp text,
  target_first_lesson_date date,
  target_source text,
  target_detail text default null,
  target_technical jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
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
     length(cpf_digits)<>11 or length(phone_digits)<10 or length(phone_digits)>13 then
    raise exception 'Preencha nome, nascimento, CPF e WhatsApp válidos para a matrícula.'
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
    whatsapp=btrim(target_whatsapp),
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
$$;


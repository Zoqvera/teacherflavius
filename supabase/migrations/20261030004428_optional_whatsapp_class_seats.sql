-- Make the phone optional for browser-based reservations, preserving the
-- existing 3-argument endpoints for already-open pages.
alter table private.class_seat_holds alter column whatsapp drop not null;
alter table private.class_seat_waitlist alter column whatsapp drop not null;

-- The opaque browser key is hashed before storage and is used only for
-- short-term deduplication; it is not an identity verification mechanism.
create function private.class_seat_applicant_key(
  target_whatsapp text, target_client_key text
) returns text language plpgsql immutable security invoker set search_path='' as $$
declare
  phone text;
begin
  if target_client_key is null or target_client_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Identificação da reserva indisponível. Atualize a página.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(target_whatsapp,'')),'') is not null then
    phone := private.normalize_trial_phone(target_whatsapp);
    if phone is null then
      raise exception 'O WhatsApp informado precisa incluir um DDD válido.' using errcode='22023';
    end if;
    return phone;
  end if;
  return 'device:' || encode(extensions.digest(target_client_key,'sha256'),'hex');
end;
$$;

create function public.create_public_class_seat_hold(
  target_class_number integer,
  target_name text,
  target_whatsapp text,
  target_client_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  applicant_key text := private.class_seat_applicant_key(target_whatsapp,target_client_key);
  applicant_name text := btrim(coalesce(target_name,''));
  secret text;
  hold_id uuid;
  expiry timestamptz;
  capacity integer;
begin
  if length(applicant_name) not between 2 and 120 then
    raise exception 'Informe seu nome para reservar.' using errcode='22023';
  end if;

  -- Capacity, active applicant and expiration changes remain atomic.
  perform pg_catalog.pg_advisory_xact_lock(73008,target_class_number);
  perform pg_catalog.pg_advisory_xact_lock(73009,hashtext(applicant_key));

  perform 1 from public.teacher_classes tc
  where tc.class_number=target_class_number and tc.is_active
    and tc.class_type='quintet'
    and tc.class_weekday is not null
    and tc.class_start_time is not null
    and upper(btrim(tc.class_name)) not like 'AULA EXPERIMENTAL%';
  if not found then
    raise exception 'Turma não disponível para reserva.' using errcode='22023';
  end if;

  update private.class_seat_holds
  set status='expired',updated_at=now()
  where normalized_phone=applicant_key
    and status='active' and expires_at<=now();

  if exists(
    select 1 from private.class_seat_holds
    where normalized_phone=applicant_key and status='active'
  ) then
    raise exception 'Já existe uma reserva vigente neste navegador ou WhatsApp.' using errcode='23505';
  end if;
  if (
    select count(*) from private.class_seat_holds
    where normalized_phone=applicant_key
      and created_at>now()-interval '24 hours'
  )>=3 then
    raise exception 'Limite diário de reservas atingido. Fale com o professor.' using errcode='22023';
  end if;

  capacity := private.get_class_operational_capacity(target_class_number);
  if capacity is null or
     private.count_class_seat_members(target_class_number)
       + private.count_class_seat_holds(target_class_number) >= capacity then
    raise exception 'A última vaga desta turma já foi ocupada. Atualize a lista.' using errcode='23514';
  end if;

  secret := encode(extensions.gen_random_bytes(32),'hex');
  expiry := now()+interval '15 minutes';
  insert into private.class_seat_holds(
    class_number,applicant_name,whatsapp,normalized_phone,token_digest,expires_at
  ) values (
    target_class_number,applicant_name,
    nullif(btrim(coalesce(target_whatsapp,'')),''),
    applicant_key,encode(extensions.digest(secret,'sha256'),'hex'),expiry
  ) returning id into hold_id;

  return jsonb_build_object(
    'reservation_id',hold_id,'token',secret,
    'expires_at',expiry,'class_number',target_class_number
  );
end;
$$;

create function public.join_public_class_seat_waitlist(
  target_class_number integer,
  target_name text,
  target_whatsapp text,
  target_client_key text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  applicant_key text := private.class_seat_applicant_key(target_whatsapp,target_client_key);
  applicant_name text := btrim(coalesce(target_name,''));
begin
  if length(applicant_name) not between 2 and 120 then
    raise exception 'Informe seu nome para entrar na lista de espera.' using errcode='22023';
  end if;

  perform 1 from public.teacher_classes
  where class_number=target_class_number and is_active and class_type='quintet'
    and class_weekday is not null and class_start_time is not null;
  if not found then raise exception 'Turma indisponível.' using errcode='22023'; end if;

  insert into private.class_seat_waitlist(
    class_number,applicant_name,whatsapp,normalized_phone
  ) values (
    target_class_number,applicant_name,
    nullif(btrim(coalesce(target_whatsapp,'')),''),applicant_key
  )
  on conflict (class_number,normalized_phone) do update set
    applicant_name=excluded.applicant_name,
    whatsapp=excluded.whatsapp,
    status='waiting',
    updated_at=now();
  return true;
end;
$$;

-- A teacher may assign a phone-less hold to an enrolled profile before
-- using the existing class-enrollment UI. That UI continues to enforce
-- source attribution and the student's first-lesson date.
create function public.assign_teacher_class_seat_hold(
  target_hold_id uuid, target_student_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  target_hold private.class_seat_holds%rowtype;
begin
  if not coalesce(public.is_teacher_admin(),false) then
    raise exception 'Acesso do professor obrigatório.' using errcode='42501';
  end if;
  if target_hold_id is null or target_student_id is null then
    raise exception 'Selecione uma reserva e um aluno.' using errcode='22023';
  end if;

  select * into target_hold from private.class_seat_holds
  where id=target_hold_id;
  if not found then
    raise exception 'Reserva não encontrada.' using errcode='P0002';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73008,target_hold.class_number);
  select * into target_hold from private.class_seat_holds
  where id=target_hold_id for update;
  if target_hold.status<>'active' or target_hold.expires_at<=now() then
    raise exception 'Esta reserva expirou ou foi encerrada.' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=target_student_id and coalesce(p.enrolled,false)
      and not coalesce(p.archived,false)
  ) then
    raise exception 'Selecione um aluno matriculado e ativo.' using errcode='23514';
  end if;
  if exists(
    select 1 from private.class_seat_holds h
    where h.id<>target_hold_id and h.status='active' and h.expires_at>now()
      and h.student_id=target_student_id
  ) then
    raise exception 'O aluno já está associado a outra reserva vigente.' using errcode='23514';
  end if;

  if exists(
    select 1 from public.class_students cs
    where cs.user_id=target_student_id and cs.class_number=target_hold.class_number
  ) then
    update private.class_seat_holds set status='claimed',
      student_id=target_student_id,updated_at=now()
    where id=target_hold_id;
  else
    update private.class_seat_holds set student_id=target_student_id,updated_at=now()
    where id=target_hold_id;
  end if;
  return true;
end;
$$;

-- A reserved seat belongs to the professor-selected student, even without
-- a phone; everyone else's class assignment still counts all active holds.
create or replace function private.guard_class_seat_holds_on_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  excluded_phone text;
  occupied_count integer;
  reserved_count integer;
  capacity integer;
begin
  if new.class_number is null then return new; end if;
  if tg_op='UPDATE' and old.class_number=new.class_number
    and old.user_id is not distinct from new.user_id
    and old.invite_id is not distinct from new.invite_id then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73008,new.class_number);
  capacity := private.get_class_operational_capacity(new.class_number);
  if capacity is null then return new; end if;

  if new.user_id is not null then
    select private.normalize_trial_phone(p.whatsapp) into excluded_phone
    from public.profiles p where p.id=new.user_id
      and coalesce(p.enrolled,false) and not coalesce(p.archived,false);
    if not exists(
      select 1 from public.profiles p
      where p.id=new.user_id and coalesce(p.enrolled,false) and not coalesce(p.archived,false)
    ) then return new; end if;
  elsif new.invite_id is null then
    return new;
  end if;

  select count(*)::integer into occupied_count
  from public.class_students cs
  left join public.profiles p on p.id=cs.user_id
  where cs.class_number=new.class_number
    and (tg_op<>'UPDATE' or cs.id<>new.id)
    and (
      cs.invite_id is not null or (
        cs.user_id is not null
        and coalesce(p.enrolled,false) and not coalesce(p.archived,false)
      )
    );

  select count(*)::integer into reserved_count
  from private.class_seat_holds h
  where h.class_number=new.class_number and h.status='active'
    and h.expires_at>now()
    and (new.user_id is null or h.student_id is distinct from new.user_id)
    and (excluded_phone is null or h.normalized_phone<>excluded_phone);

  if occupied_count+reserved_count >= capacity then
    raise exception 'Turma sem vagas: existem reservas temporárias vigentes.' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function private.claim_class_seat_hold_on_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  phone text;
begin
  if new.user_id is null then return new; end if;

  select private.normalize_trial_phone(p.whatsapp) into phone
  from public.profiles p
  where p.id=new.user_id and coalesce(p.enrolled,false)
    and not coalesce(p.archived,false);

  update private.class_seat_holds
  set status='claimed', student_id=new.user_id, updated_at=now()
  where class_number=new.class_number and status='active' and expires_at>now()
    and (
      student_id=new.user_id or (
        phone is not null and normalized_phone=phone
      )
    );

  if phone is not null then
    update private.class_seat_waitlist set status='resolved',updated_at=now()
    where class_number=new.class_number and normalized_phone=phone
      and status='waiting';
  end if;
  return new;
end;
$$;

revoke all on function private.class_seat_applicant_key(text,text)
  from public,anon,authenticated;
revoke all on function public.create_public_class_seat_hold(integer,text,text,text)
  from public,anon,authenticated;
revoke all on function public.join_public_class_seat_waitlist(integer,text,text,text)
  from public,anon,authenticated;
revoke all on function public.assign_teacher_class_seat_hold(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.create_public_class_seat_hold(integer,text,text,text)
  to anon,authenticated,service_role;
grant execute on function public.join_public_class_seat_waitlist(integer,text,text,text)
  to anon,authenticated,service_role;
grant execute on function public.assign_teacher_class_seat_hold(uuid,uuid)
  to authenticated,service_role;

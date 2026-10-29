-- 15-minute seat holds are separate from promotional-price reservations.
-- All personal data stays in private; public RPCs expose only aggregated seats.
create table private.class_seat_holds (
  id uuid primary key default gen_random_uuid(),
  class_number integer not null references public.teacher_classes(class_number),
  applicant_name text not null check (length(btrim(applicant_name)) between 2 and 120),
  whatsapp text not null,
  normalized_phone text not null,
  token_digest text not null unique,
  status text not null default 'active'
    check (status in ('active', 'expired', 'released', 'claimed')),
  student_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint seat_hold_expiry_valid check (expires_at > created_at)
);
create index class_seat_holds_active_idx
  on private.class_seat_holds(class_number, expires_at) where status='active';
create index class_seat_holds_phone_idx
  on private.class_seat_holds(normalized_phone, created_at desc);
create unique index class_seat_holds_one_active_phone
  on private.class_seat_holds(normalized_phone) where status='active';
alter table private.class_seat_holds enable row level security;
revoke all on private.class_seat_holds from public, anon, authenticated;

create table private.class_seat_waitlist (
  id uuid primary key default gen_random_uuid(),
  class_number integer not null references public.teacher_classes(class_number),
  applicant_name text not null check (length(btrim(applicant_name)) between 2 and 120),
  whatsapp text not null,
  normalized_phone text not null,
  status text not null default 'waiting' check (status in ('waiting', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_number, normalized_phone)
);
create index class_seat_waitlist_status_idx
  on private.class_seat_waitlist(status, created_at);
alter table private.class_seat_waitlist enable row level security;
revoke all on private.class_seat_waitlist from public, anon, authenticated;

create function private.count_class_seat_members(target_class_number integer)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer
  from public.class_students cs
  left join public.profiles p on p.id=cs.user_id
  where cs.class_number=target_class_number
    and (cs.invite_id is not null or
      (cs.user_id is not null and coalesce(p.enrolled,false) and not coalesce(p.archived,false)));
$$;

create function private.count_class_seat_holds(target_class_number integer, excluded_phone text default null)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer
  from private.class_seat_holds h
  where h.class_number=target_class_number and h.status='active'
    and h.expires_at>now()
    and (excluded_phone is null or h.normalized_phone<>excluded_phone);
$$;

create function private.is_recent_trial_phone(target_phone text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from private.trial_lesson_appointments trial
    where trial.whatsapp_digits='55'||target_phone
      and trial.status in ('scheduled','completed')
      and trial.starts_at >= now() - interval '45 days'
  );
$$;

-- This read is deliberately independent of the marketing page's 1-3-vacancy visibility rule.
create function public.get_public_class_seat_availability()
returns table(class_number integer, class_weekday smallint,
  class_start_time time without time zone, available_spots integer, sold_out boolean)
language sql stable security definer set search_path='' as $$
  select tc.class_number, tc.class_weekday, tc.class_start_time,
    greatest(0, private.get_class_operational_capacity(tc.class_number)
      - private.count_class_seat_members(tc.class_number)
      - private.count_class_seat_holds(tc.class_number))::integer as available_spots,
    (private.get_class_operational_capacity(tc.class_number)
      <= private.count_class_seat_members(tc.class_number)
      + private.count_class_seat_holds(tc.class_number)) as sold_out
  from public.teacher_classes tc
  where tc.is_active and tc.class_type='quintet'
    and tc.class_weekday is not null and tc.class_start_time is not null
    and upper(btrim(tc.class_name)) not like 'AULA EXPERIMENTAL%'
  order by tc.class_weekday, tc.class_start_time, tc.class_number;
$$;

create function public.create_public_class_seat_hold(
  target_class_number integer, target_name text, target_whatsapp text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  normalized text := private.normalize_trial_phone(target_whatsapp);
  cleaned_name text := btrim(coalesce(target_name,''));
  secret text;
  hold_id uuid;
  expiry timestamptz;
  capacity integer;
begin
  if length(cleaned_name) not between 2 and 120 or normalized is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos.' using errcode='22023';
  end if;
  if not private.is_recent_trial_phone(normalized) then
    raise exception 'Confirme o WhatsApp informado na aula experimental.' using errcode='22023';
  end if;

  -- Lock shared with membership triggers: two applicants cannot take the last seat.
  perform pg_catalog.pg_advisory_xact_lock(73008,target_class_number);
  perform 1 from public.teacher_classes tc
  where tc.class_number=target_class_number and tc.is_active
    and tc.class_type='quintet'
    and tc.class_weekday is not null and tc.class_start_time is not null
    and upper(btrim(tc.class_name)) not like 'AULA EXPERIMENTAL%';
  if not found then
    raise exception 'Turma não disponível para reserva.' using errcode='22023';
  end if;

  -- Expired records are released lazily; no cron or delayed worker is required.
  update private.class_seat_holds set status='expired', updated_at=now()
  where status='active' and expires_at<=now() and normalized_phone=normalized;

  if exists(select 1 from private.class_seat_holds
            where normalized_phone=normalized and status='active') then
    raise exception 'Já existe uma reserva válida para este WhatsApp.' using errcode='23505';
  end if;
  if (select count(*) from private.class_seat_holds
      where normalized_phone=normalized and created_at>now()-interval '24 hours')>=3 then
    raise exception 'Limite de reservas temporárias atingido. Entre em contato com o professor.' using errcode='22023';
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
    class_number,applicant_name,whatsapp,normalized_phone,token_digest,expires_at)
  values(target_class_number,cleaned_name,btrim(target_whatsapp),
    normalized,encode(extensions.digest(secret,'sha256'),'hex'),expiry)
  returning id into hold_id;
  return jsonb_build_object('reservation_id',hold_id,'token',secret,'expires_at',expiry,
    'class_number',target_class_number);
end;
$$;

create function public.get_public_class_seat_hold(target_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare hold private.class_seat_holds%rowtype;
begin
  if target_token is null or target_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','not_found');
  end if;
  select * into hold from private.class_seat_holds
  where token_digest=encode(extensions.digest(target_token,'sha256'),'hex');
  if not found then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status',case when hold.status='active' and hold.expires_at<=now()
    then 'expired' else hold.status end,
    'class_number',hold.class_number,'expires_at',hold.expires_at);
end;
$$;

create function public.cancel_public_class_seat_hold(target_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if target_token is null or target_token !~ '^[0-9a-f]{64}$' then return false; end if;
  update private.class_seat_holds set status='released',updated_at=now()
  where token_digest=encode(extensions.digest(target_token,'sha256'),'hex')
    and status='active' and expires_at>now();
  get diagnostics affected = row_count;
  return affected>0;
end;
$$;

create function public.join_public_class_seat_waitlist(
  target_class_number integer, target_name text, target_whatsapp text
) returns boolean language plpgsql security definer set search_path='' as $$
declare normalized text := private.normalize_trial_phone(target_whatsapp);
begin
  if length(btrim(coalesce(target_name,''))) not between 2 and 120 or normalized is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos.' using errcode='22023';
  end if;
  if not private.is_recent_trial_phone(normalized) then
    raise exception 'Confirme o WhatsApp informado na aula experimental.' using errcode='22023';
  end if;
  perform 1 from public.teacher_classes
  where class_number=target_class_number and is_active and class_type='quintet';
  if not found then raise exception 'Turma indisponível.' using errcode='22023'; end if;
  insert into private.class_seat_waitlist(class_number,applicant_name,whatsapp,normalized_phone)
  values(target_class_number,btrim(target_name),btrim(target_whatsapp),normalized)
  on conflict(class_number,normalized_phone) do update
    set applicant_name=excluded.applicant_name,whatsapp=excluded.whatsapp,
        status='waiting',updated_at=now();
  return true;
end;
$$;

-- Admin-only visibility. No private contact fields leak to anon/authenticated students.
create function public.get_teacher_class_seat_leads()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not coalesce(public.is_teacher_admin(),false) then
    raise exception 'Acesso do professor obrigatório.' using errcode='42501';
  end if;
  select jsonb_build_object(
    'holds',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',h.id,'class_number',h.class_number,'applicant_name',h.applicant_name,
      'whatsapp',h.whatsapp,'status',case when h.status='active' and h.expires_at<=now()
        then 'expired' else h.status end,'expires_at',h.expires_at,'student_id',h.student_id)
      order by h.created_at desc),'[]'::jsonb)
      from private.class_seat_holds h where h.created_at>now()-interval '14 days'),
    'waitlist',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'class_number',w.class_number,'applicant_name',w.applicant_name,
      'whatsapp',w.whatsapp,'created_at',w.created_at)
      order by w.created_at),'[]'::jsonb)
      from private.class_seat_waitlist w where w.status='waiting')
  ) into result;
  return result;
end;
$$;

create function public.resolve_teacher_class_seat_lead(
  target_id uuid, target_kind text
) returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if not coalesce(public.is_teacher_admin(),false) then
    raise exception 'Acesso do professor obrigatório.' using errcode='42501';
  end if;
  if target_kind='hold' then
    update private.class_seat_holds set status='released',updated_at=now()
    where id=target_id and status='active';
  elsif target_kind='waitlist' then
    update private.class_seat_waitlist set status='resolved',updated_at=now()
    where id=target_id and status='waiting';
  else raise exception 'Tipo inválido.' using errcode='22023';
  end if;
  get diagnostics affected = row_count;
  return affected>0;
end;
$$;

-- Prevent ordinary class assignment from silently consuming a held seat.
create function private.guard_class_seat_holds_on_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  excluded_phone text;
  current_count integer;
  capacity integer;
begin
  if new.class_number is null then return new; end if;
  if tg_op='UPDATE' and old.class_number=new.class_number
    and old.user_id is not distinct from new.user_id
    and old.invite_id is not distinct from new.invite_id then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(73008,new.class_number);
  capacity := private.get_class_operational_capacity(new.class_number);
  if capacity is null then return new; end if;
  if new.user_id is not null then
    select private.normalize_trial_phone(p.whatsapp) into excluded_phone
    from public.profiles p where p.id=new.user_id and p.enrolled and not coalesce(p.archived,false);
    if excluded_phone is null then return new; end if;
  elsif new.invite_id is null then return new;
  end if;

  select count(*)::integer into current_count
  from public.class_students cs left join public.profiles p on p.id=cs.user_id
  where cs.class_number=new.class_number
    and (tg_op<>'UPDATE' or cs.id<>new.id)
    and (cs.invite_id is not null or
      (cs.user_id is not null and coalesce(p.enrolled,false) and not coalesce(p.archived,false)));

  if current_count + private.count_class_seat_holds(new.class_number,excluded_phone) >= capacity then
    raise exception 'Turma sem vagas: existem reservas temporárias vigentes.' using errcode='23514';
  end if;
  return new;
end;
$$;

create trigger zz_guard_class_seat_holds_on_membership
before insert or update of class_number,user_id,invite_id on public.class_students
for each row execute function private.guard_class_seat_holds_on_membership();

create function private.claim_class_seat_hold_on_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare phone text;
begin
  if new.user_id is null then return new; end if;
  select private.normalize_trial_phone(p.whatsapp) into phone from public.profiles p
  where p.id=new.user_id and p.enrolled and not coalesce(p.archived,false);
  if phone is null then return new; end if;
  update private.class_seat_holds set status='claimed',student_id=new.user_id,updated_at=now()
  where class_number=new.class_number and normalized_phone=phone
    and status='active' and expires_at>now();
  update private.class_seat_waitlist set status='resolved',updated_at=now()
  where class_number=new.class_number and normalized_phone=phone and status='waiting';
  return new;
end;
$$;
create trigger zz_claim_class_seat_hold_on_membership
after insert or update of class_number,user_id on public.class_students
for each row execute function private.claim_class_seat_hold_on_membership();

revoke all on function private.count_class_seat_members(integer) from public,anon,authenticated;
revoke all on function private.count_class_seat_holds(integer,text) from public,anon,authenticated;
revoke all on function private.is_recent_trial_phone(text) from public,anon,authenticated;
revoke all on function private.guard_class_seat_holds_on_membership() from public,anon,authenticated;
revoke all on function private.claim_class_seat_hold_on_membership() from public,anon,authenticated;

revoke all on function public.get_public_class_seat_availability() from public,anon,authenticated;
revoke all on function public.create_public_class_seat_hold(integer,text,text) from public,anon,authenticated;
revoke all on function public.get_public_class_seat_hold(text) from public,anon,authenticated;
revoke all on function public.cancel_public_class_seat_hold(text) from public,anon,authenticated;
revoke all on function public.join_public_class_seat_waitlist(integer,text,text) from public,anon,authenticated;
revoke all on function public.get_teacher_class_seat_leads() from public,anon,authenticated;
revoke all on function public.resolve_teacher_class_seat_lead(uuid,text) from public,anon,authenticated;
grant execute on function public.get_public_class_seat_availability() to anon,authenticated,service_role;
grant execute on function public.create_public_class_seat_hold(integer,text,text) to anon,authenticated,service_role;
grant execute on function public.get_public_class_seat_hold(text) to anon,authenticated,service_role;
grant execute on function public.cancel_public_class_seat_hold(text) to anon,authenticated,service_role;
grant execute on function public.join_public_class_seat_waitlist(integer,text,text) to anon,authenticated,service_role;
grant execute on function public.get_teacher_class_seat_leads() to authenticated,service_role;
grant execute on function public.resolve_teacher_class_seat_lead(uuid,text) to authenticated,service_role;

-- Promotional price holds are not class seat reservations.
create table private.promotion_reservations (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
 whatsapp text not null,
 normalized_phone text generated always as (private.normalize_trial_phone(whatsapp)) stored,
 english_level text not null default 'Não definido'
   check (english_level in ('A1','A2','B1','B2','C1','C2','Não definido')),
 availability jsonb not null default '[]'::jsonb
   check (jsonb_typeof(availability)='array' and jsonb_array_length(availability)<=60),
 availability_notes text,
 reserved_on date not null default ((now() at time zone 'America/Sao_Paulo')::date),
 promotional_tuition numeric(10,2) not null check (promotional_tuition>0),
 promotion_terms text not null check (char_length(btrim(promotion_terms))>0),
 promotion_expires_on date,
 amount_paid numeric(10,2) not null default 0 check (amount_paid>=0),
 payment_date date,
 payment_method text check (payment_method in ('pix','cash','card','bank_transfer','other')),
 payment_provider text,
 payment_notes text,
 payment_disposition text not null default 'undecided'
   check (payment_disposition in ('undecided','independent','first_tuition')),
 status text not null default 'awaiting_payment'
   check (status in ('awaiting_payment','reserved','enrolled','cancelled','expired')),
 conversion_source text check (conversion_source in ('automatic','manual','dismissed')),
 matched_student_id uuid references public.profiles(id) on delete set null,
 linked_trial_id uuid references private.trial_lesson_appointments(id) on delete set null,
 credit_applied_tuition_id uuid unique references public.monthly_tuition(id) on delete set null,
 notes text,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint promotion_reservations_phone_check check (normalized_phone is not null),
 constraint promotion_reservations_date_check check (promotion_expires_on is null or promotion_expires_on>=reserved_on),
 constraint promotion_reservations_payment_check check
   ((amount_paid=0 and payment_date is null) or (amount_paid>0 and payment_date is not null and payment_method is not null)),
 constraint promotion_reservations_credit_check check
   (credit_applied_tuition_id is null or (amount_paid>0 and payment_disposition='first_tuition' and matched_student_id is not null))
);
create unique index promotion_reservations_one_open_phone
 on private.promotion_reservations(normalized_phone)
 where status in ('reserved','awaiting_payment');
create index promotion_reservations_date_idx on private.promotion_reservations(reserved_on desc);
create index promotion_reservations_student_idx on private.promotion_reservations(matched_student_id);
create index promotion_reservations_availability_idx on private.promotion_reservations using gin(availability);
alter table private.promotion_reservations enable row level security;
revoke all on private.promotion_reservations from public, anon, authenticated;

create table private.promotion_reservation_audit (
 id bigint generated always as identity primary key,
 reservation_id uuid not null references private.promotion_reservations(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 operation text not null,
 previous_state jsonb,
 current_state jsonb,
 created_at timestamptz not null default now()
);
alter table private.promotion_reservation_audit enable row level security;
revoke all on private.promotion_reservation_audit from public, anon, authenticated;

create function private.audit_promotion_reservation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.promotion_reservation_audit(reservation_id,actor_id,operation,previous_state,current_state)
 values(new.id,auth.uid(),tg_op,
 case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end; $$;
create trigger audit_promotion_reservation after insert or update on private.promotion_reservations
for each row execute function private.audit_promotion_reservation();

create function private.reconcile_promotion_reservation_enrollment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.enrolled=true and new.archived=false
  and private.normalize_trial_phone(new.whatsapp) is not null
  and (select count(*) from public.profiles p where p.enrolled=true and p.archived=false
       and private.normalize_trial_phone(p.whatsapp)=private.normalize_trial_phone(new.whatsapp))=1
 then
  update private.promotion_reservations r
   set status='enrolled', conversion_source='automatic', matched_student_id=new.id, updated_at=now()
  where r.normalized_phone=private.normalize_trial_phone(new.whatsapp)
    and r.status in ('reserved','awaiting_payment')
    and r.conversion_source is distinct from 'dismissed';
 end if;
 return new;
end; $$;
create trigger reconcile_promotion_profile_insert after insert on public.profiles
for each row execute function private.reconcile_promotion_reservation_enrollment();
create trigger reconcile_promotion_profile_update after update of enrolled,archived,whatsapp on public.profiles
for each row when (old.enrolled is distinct from new.enrolled or old.archived is distinct from new.archived or old.whatsapp is distinct from new.whatsapp)
execute function private.reconcile_promotion_reservation_enrollment();

create function public.get_teacher_promotion_reservations()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(public.is_teacher_admin_mfa(),false) then
  raise exception 'MFA do professor é obrigatório.' using errcode='42501';
 end if;
 update private.promotion_reservations set status='expired',updated_at=now()
 where status='reserved' and promotion_expires_on is not null
   and promotion_expires_on < (now() at time zone 'America/Sao_Paulo')::date;
 select coalesce(jsonb_agg(to_jsonb(r) - 'created_by' order by r.reserved_on desc, r.created_at desc),'[]'::jsonb)
 into result from (select * from private.promotion_reservations limit 2000) r;
 return result;
end; $$;

create function public.save_teacher_promotion_reservation(target_id uuid, input jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r private.promotion_reservations%rowtype;
 n text; phone text; level text; slots jsonb; reserved date; valid_until date;
 fee numeric; paid numeric; method text; pay_date date; disposition text; linked uuid; new_id uuid;
begin
 if not coalesce(public.is_teacher_admin_mfa(),false) then
  raise exception 'MFA do professor é obrigatório.' using errcode='42501';
 end if;
 if input is null or jsonb_typeof(input)<>'object' then
  raise exception 'Dados inválidos.' using errcode='22023';
 end if;
 n:=btrim(coalesce(input->>'full_name',''));
 phone:=btrim(coalesce(input->>'whatsapp',''));
 level:=coalesce(nullif(btrim(input->>'english_level'),''),'Não definido');
 slots:=coalesce(input->'availability','[]'::jsonb);
 reserved:=coalesce(nullif(input->>'reserved_on','')::date,(now() at time zone 'America/Sao_Paulo')::date);
 valid_until:=nullif(input->>'promotion_expires_on','')::date;
 fee:=nullif(input->>'promotional_tuition','')::numeric;
 paid:=coalesce(nullif(input->>'amount_paid','')::numeric,0);
 method:=nullif(btrim(coalesce(input->>'payment_method','')),'');
 pay_date:=case when paid>0 then coalesce(nullif(input->>'payment_date','')::date,reserved) else null end;
 disposition:=coalesce(nullif(btrim(input->>'payment_disposition'),''),'undecided');
 if char_length(n)<2 or char_length(n)>120 or private.normalize_trial_phone(phone) is null then
  raise exception 'Informe nome e WhatsApp com DDD válidos.' using errcode='22023';
 end if;
 if fee is null or fee<=0 or paid<0 or fee>99999999 or paid>99999999 then
  raise exception 'Valores monetários inválidos.' using errcode='22023';
 end if;
 if jsonb_typeof(slots)<>'array' or jsonb_array_length(slots)>60
  or exists(select 1 from jsonb_array_elements_text(slots) s where s.value !~ '^(seg|ter|qua|qui|sex)\\|(09|10|12|13|15|17|18|20|21):00$')
 then raise exception 'Selecione horários válidos.' using errcode='22023'; end if;
 if level not in ('A1','A2','B1','B2','C1','C2','Não definido') then raise exception 'Nível inválido.' using errcode='22023'; end if;
 if paid>0 and method not in ('pix','cash','card','bank_transfer','other') then raise exception 'Selecione a forma do pagamento.' using errcode='22023'; end if;
 if disposition not in ('undecided','independent','first_tuition') then raise exception 'Destino do pagamento inválido.' using errcode='22023'; end if;
 if valid_until is not null and valid_until<reserved then raise exception 'Validade anterior à reserva.' using errcode='22023'; end if;
 if char_length(btrim(coalesce(input->>'promotion_terms','')))=0 then
  raise exception 'Descreva as condições da promoção.' using errcode='22023';
 end if;
 if target_id is null then
   if exists(select 1 from public.profiles p where p.enrolled=true and p.archived=false
     and private.normalize_trial_phone(p.whatsapp)=private.normalize_trial_phone(phone)) then
    raise exception 'Já existe aluno matriculado com este WhatsApp.' using errcode='23514';
   end if;
   select t.id into linked from private.trial_lesson_appointments t
   where private.normalize_trial_phone(t.whatsapp)=private.normalize_trial_phone(phone)
    and t.status<>'cancelled'
   order by t.starts_at desc limit 1;
   insert into private.promotion_reservations(
     full_name,whatsapp,english_level,availability,availability_notes,reserved_on,
     promotional_tuition,promotion_terms,promotion_expires_on,amount_paid,payment_date,
     payment_method,payment_provider,payment_notes,payment_disposition,status,notes,linked_trial_id,created_by)
   values(n,phone,level,slots,nullif(btrim(coalesce(input->>'availability_notes','')),''),
     reserved,fee,btrim(input->>'promotion_terms'),valid_until,paid,pay_date,method,
     nullif(btrim(coalesce(input->>'payment_provider','')),''),
     nullif(btrim(coalesce(input->>'payment_notes','')),''),disposition,
     case when paid>0 then 'reserved' else 'awaiting_payment' end,
     nullif(btrim(coalesce(input->>'notes','')),''),linked,auth.uid())
   returning id into new_id;
 else
   select * into r from private.promotion_reservations where id=target_id for update;
   if not found then raise exception 'Reserva não encontrada.' using errcode='P0002'; end if;
   if r.credit_applied_tuition_id is not null and
     (r.amount_paid<>paid or r.payment_disposition<>disposition or r.whatsapp<>phone) then
     raise exception 'Pagamento já aplicado: não é possível alterar valor, destino ou telefone.' using errcode='23514';
   end if;
   update private.promotion_reservations set
     full_name=n,whatsapp=phone,english_level=level,availability=slots,
     availability_notes=nullif(btrim(coalesce(input->>'availability_notes','')),''),
     reserved_on=reserved,promotional_tuition=fee,promotion_terms=btrim(input->>'promotion_terms'),
     promotion_expires_on=valid_until,amount_paid=paid,payment_date=pay_date,
     payment_method=method,payment_provider=nullif(btrim(coalesce(input->>'payment_provider','')),''),
     payment_notes=nullif(btrim(coalesce(input->>'payment_notes','')),''),
     payment_disposition=disposition,notes=nullif(btrim(coalesce(input->>'notes','')),''),
     status=case when r.status in ('reserved','awaiting_payment') then
       case when paid>0 then 'reserved' else 'awaiting_payment' end else r.status end,
     updated_at=now()
   where id=target_id;
   new_id:=target_id;
 end if;
 return new_id;
exception
 when unique_violation then raise exception 'Já existe uma reserva ativa para este WhatsApp.' using errcode='23505';
end; $$;

create function public.set_teacher_promotion_reservation_status(target_id uuid,target_status text,target_student_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare existing private.promotion_reservations%rowtype;
begin
 if not coalesce(public.is_teacher_admin_mfa(),false) then
  raise exception 'MFA do professor é obrigatório.' using errcode='42501';
 end if;
 if target_status not in ('awaiting_payment','reserved','enrolled','cancelled','expired') then
  raise exception 'Situação inválida.' using errcode='22023';
 end if;
 select * into existing from private.promotion_reservations where id=target_id for update;
 if not found then raise exception 'Reserva não encontrada.' using errcode='P0002'; end if;
 if target_status='reserved' and existing.amount_paid=0 then
  raise exception 'Registre o pagamento antes de confirmar a reserva.' using errcode='23514';
 end if;
 if target_status='awaiting_payment' and existing.amount_paid>0 then
  raise exception 'Há pagamento registrado. Edite o valor antes de marcar como pendente.' using errcode='23514';
 end if;
 if target_student_id is not null and not exists(select 1 from public.profiles p
    where p.id=target_student_id and p.enrolled=true and p.archived=false) then
  raise exception 'O perfil selecionado não é um aluno matriculado ativo.' using errcode='23514';
 end if;
 update private.promotion_reservations set status=target_status,
   matched_student_id=case when target_status='enrolled' then coalesce(target_student_id,matched_student_id) else matched_student_id end,
   conversion_source=case when target_status='enrolled' then 'manual' else 'dismissed' end,
   updated_at=now() where id=target_id;
end; $$;

create function public.apply_teacher_promotion_credit(target_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare r private.promotion_reservations%rowtype; target_tuition public.monthly_tuition%rowtype;
begin
 if not coalesce(public.is_teacher_admin_mfa(),false) then
  raise exception 'MFA do professor é obrigatório.' using errcode='42501';
 end if;
 select * into r from private.promotion_reservations where id=target_id for update;
 if not found then raise exception 'Reserva não encontrada.' using errcode='P0002'; end if;
 if r.status<>'enrolled' or r.matched_student_id is null or r.payment_disposition<>'first_tuition'
   or r.amount_paid<=0 or r.credit_applied_tuition_id is not null then
  raise exception 'É necessário ter matrícula vinculada, crédito disponível e destino primeira mensalidade.' using errcode='23514';
 end if;
 select * into target_tuition from public.monthly_tuition t where t.student_id=r.matched_student_id
   order by t.reference_month,t.due_date limit 1 for update;
 if not found then raise exception 'Primeira mensalidade ainda não foi gerada.' using errcode='P0002'; end if;
 if target_tuition.payment_date is not null or target_tuition.is_exempt
   or target_tuition.payment_provider is not null then
   raise exception 'Primeira mensalidade já possui lançamento; conciliação manual necessária.' using errcode='23514';
 end if;
 if target_tuition.amount_due<>r.amount_paid then
   raise exception 'Crédito parcial ou excedente: faça conciliação financeira antes da aplicação.' using errcode='23514';
 end if;
 perform public.record_tuition_payment(target_tuition.id,coalesce(r.payment_date,r.reserved_on),
    r.amount_paid,coalesce(r.payment_method,'other'),
    'Reclassificação do pagamento da reserva promocional ' || r.id::text || '. ' || coalesce(r.payment_notes,''));
 update private.promotion_reservations set credit_applied_tuition_id=target_tuition.id,updated_at=now()
 where id=target_id;
 return target_tuition.id;
end; $$;

revoke all on function public.get_teacher_promotion_reservations() from public,anon,authenticated;
revoke all on function public.save_teacher_promotion_reservation(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.set_teacher_promotion_reservation_status(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.apply_teacher_promotion_credit(uuid) from public,anon,authenticated;
grant execute on function public.get_teacher_promotion_reservations() to authenticated;
grant execute on function public.save_teacher_promotion_reservation(uuid,jsonb) to authenticated;
grant execute on function public.set_teacher_promotion_reservation_status(uuid,text,uuid) to authenticated;
grant execute on function public.apply_teacher_promotion_credit(uuid) to authenticated;

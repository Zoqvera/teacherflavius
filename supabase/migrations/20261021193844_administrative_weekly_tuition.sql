-- Weekly administrative tuition, independent from legacy monthly_tuition.
create table if not exists private.administrative_weekly_plans (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  weekly_fee numeric(10,2) not null check (weekly_fee > 0),
  due_weekday smallint not null default 2 check (due_weekday = 2),
  first_due_date date not null check (extract(isodow from first_due_date) = 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
revoke all on private.administrative_weekly_plans from public, anon, authenticated;

create table if not exists public.administrative_weekly_tuition (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  due_date date not null check (extract(isodow from due_date) = 2),
  amount_due numeric(10,2) not null check(amount_due > 0),
  payment_date date,
  amount_paid numeric(10,2) check (amount_paid > 0),
  payment_method text check (payment_method in ('pix','cash','bank_transfer','card','other')),
  payment_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, due_date),
  constraint weekly_payment_consistency check (
    (payment_date is null and amount_paid is null and payment_method is null)
    or (payment_date is not null and amount_paid is not null and payment_method is not null)
  )
);
alter table public.administrative_weekly_tuition enable row level security;
revoke all on public.administrative_weekly_tuition from public, anon, authenticated;
create index if not exists administrative_weekly_tuition_due_idx
  on public.administrative_weekly_tuition (due_date, student_id);
comment on table public.administrative_weekly_tuition is
  'Independent Tuesday-only billing ledger for administrative students. Never generate monthly_tuition for these plans.';

-- Weekly students may belong to three individual classes without lifting the
-- two-class limit for the remainder of the student population.
create or replace function public.enforce_class_students_max_two_classes()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  assignment_count integer;
  subject_key text;
  maximum_classes integer := 2;
begin
  if new.user_id is not null then
    subject_key := 'user:' || new.user_id::text;
    if exists (
      select 1 from public.class_students cs
      where cs.class_number = new.class_number and cs.user_id = new.user_id
        and (tg_op <> 'UPDATE' or cs.id <> new.id)
    ) then return new; end if;
    if exists (
      select 1 from private.administrative_weekly_plans wp
      join public.profiles p on p.id = wp.student_id
      where wp.student_id = new.user_id and wp.active is true
        and p.access_mode = 'administrative' and p.class_type = 'INDIVIDUAL'
    ) then
      maximum_classes := 3;
    end if;
  elsif new.invite_id is not null then
    subject_key := 'invite:' || new.invite_id::text;
    if exists (
      select 1 from public.class_students cs
      where cs.class_number = new.class_number and cs.invite_id = new.invite_id
        and (tg_op <> 'UPDATE' or cs.id <> new.id)
    ) then return new; end if;
  else
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(subject_key, 73009)
  );
  if new.user_id is not null then
    select count(*)::integer into assignment_count
    from public.class_students cs
    where cs.user_id = new.user_id
      and (tg_op <> 'UPDATE' or cs.id <> new.id);
  else
    select count(*)::integer into assignment_count
    from public.class_students cs
    where cs.invite_id = new.invite_id
      and (tg_op <> 'UPDATE' or cs.id <> new.id);
  end if;
  if assignment_count >= maximum_classes then
    raise exception 'O aluno já está vinculado ao limite de % turmas.', maximum_classes
      using errcode='23514';
  end if;
  return new;
end;
$function$;

-- Cron uses a private function, never exposed to browser clients.
create or replace function private.generate_administrative_weekly_tuition(
  target_until_date date default (now() at time zone 'America/Sao_Paulo')::date
)
returns integer language plpgsql security definer set search_path = ''
as $function$
declare
  inserted_count integer := 0;
  today_local date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if target_until_date > today_local + 14 then
    raise exception 'Não é permitido gerar cobranças semanais fora da janela.';
  end if;
  insert into public.administrative_weekly_tuition (student_id,due_date,amount_due)
  select plan.student_id, scheduled.day::date, plan.weekly_fee
  from private.administrative_weekly_plans plan
  join public.profiles p on p.id=plan.student_id
  cross join lateral generate_series(
    plan.first_due_date::timestamp,
    target_until_date::timestamp,
    interval '7 days'
  ) as scheduled(day)
  where plan.active is true
    and p.enrolled is true and p.archived is false
    and p.access_mode='administrative'
    and not exists (
      select 1 from public.student_course_states s
      where s.student_id=plan.student_id
        and (s.course_status='paused' or s.billing_exemption='permanent')
    )
  on conflict (student_id,due_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;
revoke all on function private.generate_administrative_weekly_tuition(date)
 from public, anon, authenticated;

-- Generates the charges as they become due in São Paulo local time.
select cron.schedule(
  'teacher-administrative-weekly-tuition',
  '30 6 * * *',
  $$select private.generate_administrative_weekly_tuition((now() at time zone 'America/Sao_Paulo')::date);$$
);

create or replace function public.get_teacher_administrative_weekly_tuition()
returns table (
  tuition_id uuid,
  student_id uuid,
  student_name text,
  due_date date,
  amount_due numeric,
  payment_date date,
  amount_paid numeric,
  payment_method text,
  payment_notes text,
  status text
)
language plpgsql security definer set search_path=''
as $function$
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.' using errcode='42501';
  end if;
  return query select
    invoice.id, invoice.student_id, p.name,
    invoice.due_date, invoice.amount_due, invoice.payment_date,
    invoice.amount_paid, invoice.payment_method, invoice.payment_notes,
    case
      when invoice.payment_date is not null then 'paid'
      when invoice.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'overdue'
      when invoice.due_date = (now() at time zone 'America/Sao_Paulo')::date then 'due_today'
      else 'open'
    end::text
  from public.administrative_weekly_tuition invoice
  join public.profiles p on p.id=invoice.student_id
  order by invoice.due_date desc, p.name asc
  limit 1000;
end;
$function$;
revoke all on function public.get_teacher_administrative_weekly_tuition()
 from public,anon;
grant execute on function public.get_teacher_administrative_weekly_tuition()
 to authenticated,service_role;

create or replace function public.record_teacher_administrative_weekly_payment(
  target_tuition_id uuid,
  target_payment_date date,
  target_amount_paid numeric,
  target_payment_method text,
  target_payment_notes text default null
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  target_invoice public.administrative_weekly_tuition%rowtype;
  clean_method text := lower(btrim(coalesce(target_payment_method,'')));
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso exclusivo do professor.' using errcode='42501';
  end if;
  select * into target_invoice from public.administrative_weekly_tuition
  where id=target_tuition_id for update;
  if not found then raise exception 'Cobrança semanal não encontrada.'; end if;
  if target_invoice.payment_date is not null then
    raise exception 'Esta cobrança semanal já está paga.';
  end if;
  if target_amount_paid is null or target_amount_paid<=0 then
    raise exception 'Informe um valor pago positivo.';
  end if;
  if clean_method not in ('pix','cash','bank_transfer','card','other') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  update public.administrative_weekly_tuition set
    payment_date = coalesce(target_payment_date,(now() at time zone 'America/Sao_Paulo')::date),
    amount_paid=round(target_amount_paid,2), payment_method=clean_method,
    payment_notes=nullif(btrim(target_payment_notes),''),
    updated_at=now()
  where id=target_tuition_id;
  return jsonb_build_object('ok',true,'tuition_id',target_tuition_id);
end;
$function$;
revoke all on function public.record_teacher_administrative_weekly_payment(uuid,date,numeric,text,text)
 from public,anon;
grant execute on function public.record_teacher_administrative_weekly_payment(uuid,date,numeric,text,text)
 to authenticated,service_role;

-- The internal entrypoint is atomic. It only accepts an Auth account previously
-- created and blocked by the teacher-authorized Edge Function.
create or replace function public.create_teacher_administrative_weekly_student_internal(
  target_user_id uuid,
  target_actor_id uuid,
  target_name text,
  target_whatsapp text,
  target_contact_email text,
  target_weekly_fee numeric,
  target_first_due_date date,
  target_classes jsonb
)
returns jsonb
language plpgsql security invoker set search_path=''
as $function$
declare
  item jsonb;
  target_class public.teacher_classes%rowtype;
  class_count integer := 0;
  today_local date := (now() at time zone 'America/Sao_Paulo')::date;
  assignment_id uuid;
  seen_numbers integer[] := '{}';
  actual_date date;
  clean_name text := nullif(btrim(target_name),'');
  clean_email text := nullif(lower(btrim(target_contact_email)),'');
  created_tuition uuid;
begin
  if not exists (select 1 from public.teacher_admins ta where ta.user_id=target_actor_id) then
    raise exception 'Professor não autorizado.' using errcode='42501';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = target_user_id
      and u.email = ('student-' || target_user_id::text || '@administrativo.teacherflavius.com')
      and u.banned_until > now()
  ) then
    raise exception 'Conta técnica sem bloqueio de acesso.' using errcode='42501';
  end if;
  if clean_name is null or length(clean_name)<3 or length(clean_name)>160 then
    raise exception 'Informe o nome completo do aluno.';
  end if;
  if clean_email is not null and exists (
    select 1 from public.profiles p where lower(p.email)=clean_email
      and p.archived is false
  ) then raise exception 'Já existe cadastro ativo com este e-mail.'; end if;
  if target_weekly_fee is null or target_weekly_fee<=0
    or target_weekly_fee>100000 then
    raise exception 'Valor semanal inválido.';
  end if;
  if target_first_due_date is null
    or extract(isodow from target_first_due_date)::integer <> 2
    or target_first_due_date<today_local then
    raise exception 'O primeiro vencimento deve ocorrer em uma terça-feira futura ou hoje.';
  end if;
  if jsonb_typeof(target_classes) <> 'array'
    or jsonb_array_length(target_classes) <> 3 then
    raise exception 'Informe exatamente três turmas individuais.';
  end if;
  for item in select value from jsonb_array_elements(target_classes)
  loop
    class_count := class_count+1;
    if nullif(item->>'class_number','') is null
      or nullif(item->>'first_lesson_date','') is null then
      raise exception 'Informe a turma e a data de sua primeira aula.';
    end if;
    if (item->>'class_number')::integer = any(seen_numbers) then
      raise exception 'Cada turma só pode aparecer uma vez.';
    end if;
    seen_numbers := array_append(seen_numbers,(item->>'class_number')::integer);
    actual_date := (item->>'first_lesson_date')::date;
    select * into target_class from public.teacher_classes
    where class_number=(item->>'class_number')::integer and is_active is true
      and class_type='individual' for update;
    if not found or target_class.class_weekday is null then
      raise exception 'Turma individual indisponível.';
    end if;
    if target_class.class_start_time<>'14:00'::time
      or extract(isodow from actual_date)::integer <> target_class.class_weekday
      or actual_date<today_local then
      raise exception 'Data e horário da primeira aula devem corresponder à turma.';
    end if;
  end loop;

  insert into public.profiles (
    id,name,email,whatsapp,enrolled,profile_completed,class_type,enrolled_at,
    access_mode
  ) values (
    target_user_id,clean_name,clean_email,nullif(btrim(target_whatsapp),''),
    true,true,'INDIVIDUAL',now(),'administrative'
  );

  insert into private.administrative_weekly_plans (
    student_id,weekly_fee,first_due_date,created_by
  ) values (
    target_user_id,round(target_weekly_fee,2),target_first_due_date,target_actor_id
  );
  for item in select value from jsonb_array_elements(target_classes)
  loop
    actual_date := (item->>'first_lesson_date')::date;
    insert into public.class_students(class_number,user_id,first_lesson_date)
    values ((item->>'class_number')::integer,target_user_id,actual_date)
    returning id into assignment_id;
    -- This teacher-confirmed date overrides the default auto-next-date logic.
    update public.class_students set first_lesson_date=actual_date
    where id=assignment_id;
  end loop;

  insert into public.administrative_weekly_tuition(student_id,due_date,amount_due)
  values(target_user_id,target_first_due_date,round(target_weekly_fee,2))
  returning id into created_tuition;
  return jsonb_build_object('ok',true,'student_id',target_user_id,
    'weekly_tuition_id',created_tuition,'first_due_date',target_first_due_date,
    'weekly_fee',round(target_weekly_fee,2),'class_numbers',seen_numbers);
end;
$function$;
revoke all on function public.create_teacher_administrative_weekly_student_internal(
  uuid,uuid,text,text,text,numeric,date,jsonb
) from public,anon,authenticated;
grant execute on function public.create_teacher_administrative_weekly_student_internal(
  uuid,uuid,text,text,text,numeric,date,jsonb
) to service_role;

notify pgrst,'reload schema';

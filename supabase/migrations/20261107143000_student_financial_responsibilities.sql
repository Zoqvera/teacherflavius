-- Responsibility for another student's tuition.
-- No checkout or existing tuition is altered by this migration.
create table if not exists private.student_financial_responsibilities (
  id uuid primary key default gen_random_uuid(),
  payer_student_id uuid not null references public.profiles(id) on delete cascade,
  beneficiary_student_id uuid not null references public.profiles(id) on delete cascade,
  first_reference_month date not null,
  first_uncovered_month date,
  state text not null default 'active' check (state in ('active', 'ended', 'cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  ended_by uuid,
  ended_at timestamptz,
  constraint distinct_financial_students check (payer_student_id <> beneficiary_student_id),
  constraint first_financial_month_normalized check (extract(day from first_reference_month) = 1),
  constraint final_financial_month_normalized check (
    first_uncovered_month is null or extract(day from first_uncovered_month) = 1
  ),
  constraint consistent_financial_responsibility_state check (
    (state = 'active' and first_uncovered_month is null and ended_at is null)
    or (state = 'ended' and first_uncovered_month > first_reference_month and ended_at is not null)
    or (state = 'cancelled' and first_uncovered_month = first_reference_month and ended_at is not null)
  )
);

create unique index if not exists one_active_financial_responsibility_per_student
  on private.student_financial_responsibilities (beneficiary_student_id)
  where state = 'active';

create index if not exists student_financial_responsibilities_payer_period_idx
  on private.student_financial_responsibilities (payer_student_id, first_reference_month);

alter table private.student_financial_responsibilities enable row level security;
revoke all on private.student_financial_responsibilities from anon, authenticated;

comment on table private.student_financial_responsibilities is
  'Contractual payer-to-beneficiary linkage, not a tuition exemption. Settlement remains per student.';

create or replace function public.get_teacher_financial_responsibilities()
returns table (
  responsibility_id uuid,
  payer_student_id uuid,
  payer_name text,
  beneficiary_student_id uuid,
  beneficiary_name text,
  first_reference_month date,
  first_uncovered_month date,
  responsibility_state text,
  notes text
)
language plpgsql stable security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;

  return query
  select link.id, link.payer_student_id, payer.name, link.beneficiary_student_id,
         beneficiary.name, link.first_reference_month, link.first_uncovered_month,
         link.state, link.notes
  from private.student_financial_responsibilities link
  join public.profiles payer on payer.id = link.payer_student_id
  join public.profiles beneficiary on beneficiary.id = link.beneficiary_student_id
  order by (link.state = 'active') desc, link.created_at desc;
end;
$function$;

create or replace function public.set_teacher_financial_responsibility(
  target_beneficiary_student_id uuid,
  target_payer_student_id uuid,
  target_first_reference_month date default null,
  target_notes text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  chosen_month date := date_trunc('month', coalesce(target_first_reference_month, timezone('America/Sao_Paulo', now())::date))::date;
  current_month date := date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date;
  existing_id uuid;
  created_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;

  if target_beneficiary_student_id is null or target_payer_student_id is null
     or target_beneficiary_student_id = target_payer_student_id then
    raise exception 'Selecione dois alunos diferentes.';
  end if;

  if chosen_month < current_month or
     (target_first_reference_month is not null
      and extract(day from target_first_reference_month) <> 1) then
    raise exception 'A vigência deve iniciar no primeiro dia do mês atual ou futuro.';
  end if;

  -- Serialize concurrent administrative edits of the same beneficiary.
  perform pg_advisory_xact_lock(hashtextextended(target_beneficiary_student_id::text, 20261107));

  if (select count(*) from public.profiles p
      join public.student_billing_settings b on b.student_id = p.id
      where p.id in (target_beneficiary_student_id, target_payer_student_id)
        and coalesce(p.enrolled, false) and not coalesce(p.archived, false)
        and b.active and b.monthly_fee > 0) <> 2 then
    raise exception 'Ambos os alunos devem estar matriculados, ativos e com mensalidades configuradas.';
  end if;

  select link.id into existing_id
  from private.student_financial_responsibilities link
  where link.beneficiary_student_id = target_beneficiary_student_id
    and link.state = 'active';

  if existing_id is not null then
    if exists (
      select 1 from private.student_financial_responsibilities link
      where link.id = existing_id and link.payer_student_id = target_payer_student_id
        and link.first_reference_month = chosen_month
    ) then
      return existing_id;
    end if;
    raise exception 'O aluno já possui responsável financeiro ativo. Encerre primeiro esse vínculo.';
  end if;

  -- A payer cannot be a beneficiary, and vice versa: no indirect financial cycles.
  if exists (
    select 1 from private.student_financial_responsibilities link
    where link.state = 'active'
      and (
        link.beneficiary_student_id = target_payer_student_id
        or link.payer_student_id = target_beneficiary_student_id
      )
  ) then
    raise exception 'Não é permitido encadear responsáveis financeiros.';
  end if;

  if exists (
    select 1 from private.student_financial_responsibilities link
    where link.beneficiary_student_id = target_beneficiary_student_id
      and link.state = 'ended'
      and link.first_uncovered_month > chosen_month
  ) then
    raise exception 'O período solicitado se sobrepõe a um vínculo anterior.';
  end if;

  -- Never retroactively redirect an already-settled invoice or pending provider payment.
  if exists (
    select 1 from public.monthly_tuition tuition
    where tuition.student_id in (target_beneficiary_student_id, target_payer_student_id)
      and tuition.reference_month >= chosen_month
      and (tuition.payment_date is not null or tuition.is_exempt)
  ) or exists (
    select 1 from public.tuition_payment_attempts attempt
    join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
    where tuition.student_id in (target_beneficiary_student_id, target_payer_student_id)
      and tuition.reference_month >= chosen_month
      and attempt.status in ('created', 'pending', 'authorized', 'in_process', 'in_mediation')
  ) then
    raise exception 'Existem mensalidades quitadas/isentas ou pagamentos em andamento. Escolha uma competência futura livre.';
  end if;

  insert into private.student_financial_responsibilities (
    payer_student_id, beneficiary_student_id, first_reference_month, notes, created_by
  )
  values (
    target_payer_student_id, target_beneficiary_student_id, chosen_month,
    nullif(left(trim(coalesce(target_notes, '')), 800), ''), auth.uid()
  )
  returning id into created_id;

  return created_id;
end;
$function$;

create or replace function public.end_teacher_financial_responsibility(
  target_beneficiary_student_id uuid,
  target_first_uncovered_month date default null
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $function$
declare
  chosen_month date := date_trunc('month', coalesce(target_first_uncovered_month, (date_trunc('month', timezone('America/Sao_Paulo', now())::date) + interval '1 month')::date))::date;
  existing_link private.student_financial_responsibilities%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo obrigatório.' using errcode = '42501';
  end if;

  if target_beneficiary_student_id is null
      or (target_first_uncovered_month is not null
          and extract(day from target_first_uncovered_month) <> 1)
      or chosen_month < date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date then
    raise exception 'O encerramento deve ocorrer no primeiro dia de uma competência atual ou futura.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_beneficiary_student_id::text, 20261107));
  select * into existing_link
  from private.student_financial_responsibilities link
  where link.beneficiary_student_id = target_beneficiary_student_id and link.state = 'active'
  for update;

  if not found then
    raise exception 'O aluno não possui responsável financeiro ativo.';
  end if;

  if chosen_month < existing_link.first_reference_month then
    raise exception 'Não é possível encerrar o vínculo antes de seu início.';
  end if;

  if exists (
    select 1 from public.tuition_payment_attempts attempt
    join public.monthly_tuition tuition on tuition.id = attempt.tuition_id
    where tuition.student_id in (existing_link.payer_student_id, existing_link.beneficiary_student_id)
      and tuition.reference_month >= chosen_month
      and attempt.status in ('created', 'pending', 'authorized', 'in_process', 'in_mediation')
  ) then
    raise exception 'Há pagamentos em andamento a partir dessa competência.';
  end if;

  update private.student_financial_responsibilities
  set state = case when chosen_month = first_reference_month then 'cancelled' else 'ended' end,
      first_uncovered_month = chosen_month, ended_by = auth.uid(), ended_at = now()
  where id = existing_link.id;

  return existing_link.id;
end;
$function$;

revoke all on function public.get_teacher_financial_responsibilities() from public, anon;
revoke all on function public.set_teacher_financial_responsibility(uuid, uuid, date, text) from public, anon;
revoke all on function public.end_teacher_financial_responsibility(uuid, date) from public, anon;
grant execute on function public.get_teacher_financial_responsibilities() to authenticated;
grant execute on function public.set_teacher_financial_responsibility(uuid, uuid, date, text) to authenticated;
grant execute on function public.end_teacher_financial_responsibility(uuid, date) to authenticated;

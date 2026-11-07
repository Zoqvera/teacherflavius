-- Stage 4: archiving, temporal consistency and financial eligibility.

-- Stop financial sponsorship atomically when either student is archived.
-- The paid or in-flight competence is retained for reconciliation/history;
-- an unpaid competence with no attempt is released immediately.
create or replace function private.end_financial_responsibilities_on_archive()
returns trigger language plpgsql security definer set search_path = ''
as $archive$
declare
  relationship private.student_financial_responsibilities%rowtype;
  current_reference date := date_trunc('month', timezone('America/Sao_Paulo',now())::date)::date;
  cutoff date;
  future_cutoff date := (date_trunc('month',timezone('America/Sao_Paulo',now())::date) + interval '1 month')::date;
begin
  if new.archived is not true or old.archived is true then
    return new;
  end if;

  for relationship in
    select link.*
    from private.student_financial_responsibilities link
    where link.state = 'active'
      and (link.payer_student_id = new.id or link.beneficiary_student_id = new.id)
    order by link.beneficiary_student_id
    for update
  loop
    cutoff := greatest(relationship.first_reference_month,current_reference);

    if exists (
      select 1
      from public.monthly_tuition invoice
      where invoice.student_id in (
          relationship.payer_student_id,relationship.beneficiary_student_id
        )
        and invoice.reference_month = current_reference
        and (invoice.payment_date is not null or invoice.is_exempt)
    ) or exists (
      select 1
      from public.tuition_payment_attempts attempt
      join public.monthly_tuition invoice on invoice.id = attempt.tuition_id
      where invoice.student_id in (
        relationship.payer_student_id, relationship.beneficiary_student_id
      )
        and invoice.reference_month = current_reference
        and attempt.status in (
          'created','pending','authorized','in_process','in_mediation'
        )
    ) then
      cutoff := greatest(relationship.first_reference_month,future_cutoff);
    end if;

    update private.student_financial_responsibilities link
    set state = case when cutoff = relationship.first_reference_month
                      then 'cancelled' else 'ended' end,
        first_uncovered_month = cutoff,
        ended_by = auth.uid(),
        ended_at = now(),
        notes = concat_ws(E'\n',nullif(link.notes,''),'Encerramento automático por arquivamento de aluno')
    where link.id = relationship.id;
  end loop;

  return new;
end;
$archive$;

drop trigger if exists archive_student_end_financial_responsibility on public.profiles;
create trigger archive_student_end_financial_responsibility
  before update of archived on public.profiles
  for each row
  when (new.archived is true and old.archived is distinct from true)
  execute function private.end_financial_responsibilities_on_archive();

revoke all on function private.end_financial_responsibilities_on_archive()
  from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.set_teacher_financial_responsibility(target_beneficiary_student_id uuid, target_payer_student_id uuid, target_first_reference_month date DEFAULT NULL::date, target_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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


  -- A single monthly charge requires a single contractual due day.
  if (
    select count(distinct billing.due_day)
    from public.student_billing_settings billing
    where billing.student_id in (
      target_beneficiary_student_id,target_payer_student_id
    ) and billing.active
  ) <> 1 then
    raise exception 'Para reunir as mensalidades, os dois alunos devem ter o mesmo dia de vencimento.';
  end if;

  if exists (
    select 1
    from public.monthly_tuition payer_invoice
    join public.monthly_tuition beneficiary_invoice
      on beneficiary_invoice.reference_month = payer_invoice.reference_month
     and beneficiary_invoice.student_id = target_beneficiary_student_id
    where payer_invoice.student_id = target_payer_student_id
      and payer_invoice.reference_month >= chosen_month
      and payer_invoice.due_date <> beneficiary_invoice.due_date
  ) then
    raise exception 'As mensalidades existentes têm datas de vencimento diferentes.';
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
CREATE OR REPLACE FUNCTION public.end_teacher_financial_responsibility(target_beneficiary_student_id uuid, target_first_uncovered_month date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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


  -- Preserve attribution for any month already settled before termination.
  if exists (
    select 1 from public.monthly_tuition invoice
    where invoice.student_id in (
      existing_link.payer_student_id, existing_link.beneficiary_student_id
    )
      and invoice.reference_month >= chosen_month
      and invoice.payment_date is not null
  ) then
    raise exception 'Há mensalidades pagas nesse período. Encerre a responsabilidade a partir de uma competência posterior.';
  end if;

  update private.student_financial_responsibilities
  set state = case when chosen_month = first_reference_month then 'cancelled' else 'ended' end,
      first_uncovered_month = chosen_month, ended_by = auth.uid(), ended_at = now()
  where id = existing_link.id;

  return existing_link.id;
end;
$function$;
CREATE OR REPLACE FUNCTION private.quote_financial_responsibility_payment(target_payer_id uuid, target_tuition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  primary_tuition public.monthly_tuition%rowtype;
  dependent record;
  dependent_tuition public.monthly_tuition%rowtype;
  items jsonb := '[]'::jsonb;
  total numeric(10,2);
begin
  select * into primary_tuition from public.monthly_tuition
  where id = target_tuition_id and student_id = target_payer_id;

  if not found then
    raise exception 'A mensalidade não pertence ao pagante.';
  end if;


  if not exists (
    select 1 from public.profiles p
    join public.student_billing_settings billing on billing.student_id=p.id
    where p.id=target_payer_id and p.enrolled and not coalesce(p.archived,false)
      and billing.active
  ) then
    raise exception 'O responsável financeiro está inativo ou arquivado.';
  end if;

  if primary_tuition.payment_date is not null or primary_tuition.is_exempt then
    raise exception 'Esta mensalidade já foi liquidada ou está isenta.';
  end if;

  -- Sponsored students cannot initiate their own payment for a covered month.
  if exists (
    select 1 from private.student_financial_responsibilities link
    where link.beneficiary_student_id = target_payer_id and link.state <> 'cancelled'
      and link.first_reference_month <= primary_tuition.reference_month
      and (link.first_uncovered_month is null
           or primary_tuition.reference_month < link.first_uncovered_month)
  ) then
    raise exception 'Esta mensalidade é paga pelo responsável financeiro.';
  end if;

  total := round(primary_tuition.amount_due, 2);
  items := jsonb_build_array(jsonb_build_object(
    'tuition_id', primary_tuition.id,
    'student_id', target_payer_id,
    'amount', total,
    'role', 'payer'
  ));

  for dependent in
    select link.beneficiary_student_id, profile.name
    from private.student_financial_responsibilities link
    join public.profiles profile on profile.id = link.beneficiary_student_id
    where link.payer_student_id = target_payer_id and link.state <> 'cancelled'
      and link.first_reference_month <= primary_tuition.reference_month
      and (link.first_uncovered_month is null
           or primary_tuition.reference_month < link.first_uncovered_month)
    order by link.beneficiary_student_id
  loop
    select * into dependent_tuition
    from public.monthly_tuition
    where student_id = dependent.beneficiary_student_id
      and reference_month = primary_tuition.reference_month;

    if not found then
      raise exception 'A mensalidade do aluno coberto ainda não foi gerada.';
    end if;

    if not exists (
      select 1 from public.profiles p
      join public.student_billing_settings billing on billing.student_id=p.id
      where p.id=dependent.beneficiary_student_id
        and p.enrolled and not coalesce(p.archived,false) and billing.active
    ) then
      raise exception 'Um aluno beneficiário está inativo ou arquivado.';
    end if;

    if dependent_tuition.payment_date is not null or dependent_tuition.is_exempt then
      raise exception 'Uma mensalidade coberta já foi paga ou está isenta.';
    end if;

    -- Never force a beneficiary into payment before their tuition is
    -- eligible for checkout under the existing first-payment release policy.
    if not exists (
      select 1
      from private.get_tuition_student_availability(dependent_tuition.id) availability
      where availability.available_on is not null
        and availability.available_on <= timezone('America/Sao_Paulo', now())::date
    ) then
      raise exception 'A mensalidade do aluno coberto ainda não está liberada para pagamento.';
    end if;

    if public.is_first_tuition_payment_closed(dependent_tuition.id) then
      raise exception 'A primeira mensalidade do aluno coberto está fora do prazo de pagamento.';
    end if;

    total := total + round(dependent_tuition.amount_due, 2);
    items := items || jsonb_build_array(jsonb_build_object(
      'tuition_id', dependent_tuition.id,
      'student_id', dependent.beneficiary_student_id,
      'student_name', dependent.name,
      'amount', round(dependent_tuition.amount_due, 2),
      'role', 'beneficiary'
    ));
  end loop;

  return jsonb_build_object(
    'payer_student_id', target_payer_id,
    'primary_tuition_id', target_tuition_id,
    'reference_month', primary_tuition.reference_month,
    'total', round(total, 2),
    'sponsored', jsonb_array_length(items) > 1,
    'items', items
  );
end;
$function$;

-- Resume monthly billing from the next eligible due date after unarchiving.
-- Preserve permanent exemptions and historical invoices.
create or replace function private.resume_monthly_billing_after_unarchive()
returns trigger language plpgsql security definer set search_path = ''
as $body$
declare
  billing public.student_billing_settings%rowtype;
  today_local date := timezone('America/Sao_Paulo',now())::date;
  next_due date;
  effective_start date;
begin
  if new.archived is true or old.archived is distinct from true then
    return new;
  end if;

  if not coalesce(new.enrolled,false) then return new; end if;

  select * into billing
  from public.student_billing_settings
  where student_id = new.id
  for update;
  if not found or billing.monthly_fee <= 0 or billing.due_day is null then
    return new;
  end if;

  -- Explicit permanent exemptions must not be silently overridden.
  if exists (
    select 1 from public.student_course_states state
    where state.student_id = new.id and state.billing_exemption = 'permanent'
  ) then
    return new;
  end if;

  next_due := public.first_tuition_due_date_after(today_local,billing.due_day);
  if next_due is null then
    raise exception 'Não foi possível calcular o próximo vencimento para reativação.';
  end if;

  effective_start := greatest(
    billing.billing_start_month, date_trunc('month',next_due)::date
  );

  -- A student returns without a class: billing may continue in
  -- 'awaiting_class', not in the operational 'paused' state.
  update public.student_course_states state
  set course_status='awaiting_class',
      billing_block_from_month=null,
      status_since=today_local,
      status_reason='Cobrança retomada após desarquivamento; aguardando turma',
      updated_at=now(),
      updated_by=auth.uid()
  where state.student_id = new.id
    and state.course_status = 'paused'
    and state.billing_exemption is distinct from 'permanent';

  -- The first due date is reanchored to the post-archive restart only.
  -- Already-generated historical monthly_tuition rows are not edited.
  update public.profiles p
  set tuition_first_due_date=next_due
  where p.id=new.id
    and (
      p.tuition_first_due_date is null
      or p.tuition_first_due_date < effective_start
    );

  update public.student_billing_settings b
  set active=true,
      billing_start_month=effective_start,
      updated_at=now(),
      updated_by=auth.uid()
  where b.student_id=new.id
    and b.active is distinct from true;

  return new;
end;
$body$;

drop trigger if exists resume_monthly_billing_after_unarchive on public.profiles;
create trigger resume_monthly_billing_after_unarchive
  after update of archived on public.profiles
  for each row
  when (old.archived is true and new.archived is distinct from true)
  execute function private.resume_monthly_billing_after_unarchive();

revoke all on function private.resume_monthly_billing_after_unarchive()
  from public,anon,authenticated;

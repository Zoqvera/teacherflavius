-- Permite usar concessões manuais nas reservas de aulas FLEXIVEL.
-- Mantém a vigência do ciclo, a revogação e a preferência por créditos contratuais.
create or replace function private.flexible_credit_for_date(
  target_student_id uuid,
  target_date date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select credit.id
  from private.lesson_credits as credit
  join public.monthly_tuition as tuition
    on tuition.id = credit.tuition_id
  where credit.student_id = target_student_id
    and credit.credit_origin in ('contract', 'manual_grant')
    and credit.status = 'available'
    and credit.revoked_at is null
    and credit.cancelled_at is null
    and credit.regular_starts_at is null
    and credit.makeup_booking_id is null
    and (
      credit.credit_origin = 'manual_grant'
      or tuition.payment_date is not null
      or coalesce(tuition.is_exempt, false)
    )
    and private.get_tuition_coverage_start(tuition.id) <= target_date
    and target_date < private.get_tuition_coverage_end(tuition.id)
  order by
    tuition.due_date,
    case when credit.credit_origin = 'contract' then 0 else 1 end,
    credit.credit_number,
    credit.id
  limit 1;
$function$;

revoke all on function private.flexible_credit_for_date(uuid, date)
  from public, anon, authenticated;

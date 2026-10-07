-- Separate lesson-occurrence cancellation from enrollment cancellation.
-- Removing a class_students membership is an enrollment operation, never a lesson-cancellation operation.

create or replace function public.cancel_my_unpaid_enrollment(target_class_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  removed_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar sua matrícula nesta turma.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  ) then
    raise exception 'Esta ação é exclusiva para alunos que ainda não fizeram o primeiro pagamento.';
  end if;

  delete from public.class_students membership
  where membership.user_id = caller_id
    and membership.class_number = target_class_number;
  get diagnostics removed_count = row_count;

  if removed_count = 0 then
    raise exception 'Você não está matriculado nesta turma.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_number', target_class_number,
    'enrollment_cancelled', true
  );
end;
$function$;

revoke execute on function public.cancel_my_unpaid_enrollment(integer) from public, anon;
grant execute on function public.cancel_my_unpaid_enrollment(integer) to authenticated, service_role;

revoke execute on function public.cancel_my_unpaid_class(integer)
  from public, anon, authenticated, service_role;
drop function if exists public.cancel_my_unpaid_class(integer);

notify pgrst, 'reload schema';

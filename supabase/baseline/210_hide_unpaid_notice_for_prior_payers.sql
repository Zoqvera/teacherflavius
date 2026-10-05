-- Recovery overlay for the first-payment notice eligibility rule.

-- Do not show the first-payment warning to students who have already settled any tuition.
-- The special class-release action is also restricted to students who have never paid.

create or replace function public.get_my_lessons_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  current_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  enrolled_classes jsonb := '[]'::jsonb;
  classes_per_month smallint;
  settled boolean := false;
  has_paid_before boolean := false;
  available_credits integer := 0;
  current_month_credits integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_number', class.class_number,
        'class_name', class.class_name,
        'class_weekday', class.class_weekday,
        'class_start_time', class.class_start_time
      )
      order by class.class_number
    ),
    '[]'::jsonb
  )
  into enrolled_classes
  from public.class_students membership
  join public.teacher_classes class
    on class.class_number = membership.class_number
   and class.is_active = true
  where membership.user_id = caller_id;

  select settings.classes_per_month
  into classes_per_month
  from public.student_billing_settings settings
  where settings.student_id = caller_id;

  select exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and tuition.reference_month = current_month
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  )
  into settled;

  select exists (
    select 1
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false) = true)
  )
  into has_paid_before;

  select count(*)::integer
  into available_credits
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.status = 'available';

  select count(*)::integer
  into current_month_credits
  from private.lesson_credits credit
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and credit.reference_month = current_month;

  return jsonb_build_object(
    'reference_month', current_month,
    'is_paid', settled,
    'has_paid_before', has_paid_before,
    'classes_per_month', classes_per_month,
    'available_credits', available_credits,
    'current_month_credits', current_month_credits,
    'classes', enrolled_classes
  );
end;
$function$;

revoke execute on function public.get_my_lessons_overview() from public, anon;
grant execute on function public.get_my_lessons_overview() to authenticated, service_role;

create or replace function public.cancel_my_unpaid_class(target_class_number integer)
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
    'removed', true
  );
end;
$function$;

revoke execute on function public.cancel_my_unpaid_class(integer) from public, anon;
grant execute on function public.cancel_my_unpaid_class(integer) to authenticated, service_role;

notify pgrst, 'reload schema';

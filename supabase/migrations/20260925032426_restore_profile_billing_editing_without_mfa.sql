-- Restore routine billing configuration from the student profile page.
-- AAL1 teacher/admin access is sufficient for reading and configuring a student's
-- recurring fee and generating the current tuition row. Payment, exemption,
-- reversal and other high-risk financial operations remain on MFA/AAL2.

create or replace function public.get_teacher_billing_students()
returns table(
  student_id uuid,
  name text,
  email text,
  monthly_fee numeric,
  due_day smallint,
  billing_start_month date,
  billing_active boolean,
  billing_notes text
)
language plpgsql
stable
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return query
  select * from public.get_teacher_billing_students__mfa_inner();
end;
$function$;

create or replace function public.save_student_billing_settings(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return public.save_student_billing_settings__mfa_inner(
    target_student_id,
    target_monthly_fee,
    target_active,
    target_notes
  );
end;
$function$;

create or replace function public.save_student_billing_settings(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_billing_start_month date,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return public.save_student_billing_settings__mfa_inner(
    target_student_id,
    target_monthly_fee,
    target_billing_start_month,
    target_active,
    target_notes
  );
end;
$function$;

create or replace function public.save_student_billing_settings(
  target_student_id uuid,
  target_monthly_fee numeric,
  target_due_day integer,
  target_billing_start_month date,
  target_active boolean,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return public.save_student_billing_settings__mfa_inner(
    target_student_id,
    target_monthly_fee,
    target_due_day,
    target_billing_start_month,
    target_active,
    target_notes
  );
end;
$function$;

create or replace function public.generate_monthly_tuition(target_reference_month date)
returns integer
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return public.generate_monthly_tuition__mfa_inner(target_reference_month);
end;
$function$;

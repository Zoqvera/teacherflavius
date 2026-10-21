-- Administrative enrollment reuses authenticated financial records without granting portal access.
alter table public.profiles
  add column if not exists access_mode text not null default 'portal';
alter table public.profiles
  drop constraint if exists profiles_access_mode_check;
alter table public.profiles
  add constraint profiles_access_mode_check
  check (access_mode in ('portal', 'administrative'));

comment on column public.profiles.access_mode is
  'Administrative students have internal technical identities but no student portal access.';

-- Do not enqueue student onboarding emails for teacher-managed, non-portal records.
create or replace function public.queue_enrollment_email_notification()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  became_enrolled boolean := false;
begin
  if new.access_mode = 'administrative' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    became_enrolled := coalesce(new.enrolled, false);
  else
    became_enrolled := coalesce(new.enrolled, false)
      and not coalesce(old.enrolled, false);
  end if;
  if became_enrolled and not exists (
    select 1 from public.teacher_admins ta
    where ta.user_id = new.id
      or lower(ta.email) = lower(coalesce(new.email, ''))
  ) then
    insert into public.enrollment_email_notifications (student_id)
    values (new.id)
    on conflict (student_id) do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function public.queue_enrollment_email_notification() from public, anon, authenticated;

-- Only the Edge Function's service role may create a complete administrative
-- enrollment. All academic and financial writes share one SQL transaction.
create or replace function public.create_teacher_administrative_student_internal(
  target_user_id uuid,
  target_actor_id uuid,
  target_name text,
  target_contact_email text,
  target_whatsapp text,
  target_class_number integer,
  target_first_lesson_date date,
  target_monthly_fee numeric,
  target_classes_per_month integer,
  target_due_day integer,
  target_first_due_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  chosen_class public.teacher_classes%rowtype;
  requested_fee numeric := round(target_monthly_fee, 2);
  chosen_plan_id uuid;
  membership_id uuid;
  tuition_id uuid;
  today_local date := (now() at time zone 'America/Sao_Paulo')::date;
  normalized_name text := nullif(btrim(target_name), '');
  normalized_email text := nullif(lower(btrim(target_contact_email)), '');
begin
  if not exists (
    select 1 from public.teacher_admins a where a.user_id = target_actor_id
  ) then
    raise exception 'Professor não autorizado.' using errcode = '42501';
  end if;
  if target_user_id is null or not exists (
    select 1 from auth.users u
    where u.id = target_user_id
      and u.email = ('student-' || target_user_id::text || '@administrativo.teacherflavius.com')
      and u.banned_until > now()
  ) then
    raise exception 'A identidade técnica precisa estar bloqueada antes da matrícula.'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = target_user_id) then
    raise exception 'Esta identidade já possui cadastro.';
  end if;
  if normalized_name is null or char_length(normalized_name) > 160 then
    raise exception 'Informe o nome completo (até 160 caracteres).';
  end if;
  if normalized_email is not null and (
    char_length(normalized_email) > 320
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'
  ) then
    raise exception 'E-mail de contato inválido.';
  end if;
  if requested_fee is null or requested_fee <= 0 or requested_fee > 100000 then
    raise exception 'Informe uma mensalidade válida.';
  end if;
  if target_classes_per_month not between 1 and 31
    or target_due_day not between 1 and 31 then
    raise exception 'Quantidade de aulas ou dia de vencimento inválido.';
  end if;
  if target_first_due_date is null or target_first_due_date < today_local then
    raise exception 'O primeiro vencimento não pode ser anterior ao cadastro.';
  end if;

  select * into chosen_class
  from public.teacher_classes c
  where c.class_number = target_class_number
    and c.is_active = true
    and c.class_type in ('individual', 'quintet')
  for update;
  if not found or chosen_class.class_weekday is null
    or chosen_class.class_start_time is null then
    raise exception 'Selecione uma turma regular com horário definido.';
  end if;
  if target_first_lesson_date is null or
    extract(isodow from target_first_lesson_date)::integer <> chosen_class.class_weekday then
    raise exception 'A primeira aula deve corresponder ao dia da semana da turma.';
  end if;
  if chosen_class.first_lesson_date is not null
    and target_first_lesson_date < chosen_class.first_lesson_date then
    raise exception 'A primeira aula não pode anteceder o início da turma.';
  end if;

  select p.id into chosen_plan_id
  from private.billing_plans p
  where p.monthly_fee = requested_fee
    and p.classes_per_month = target_classes_per_month
    and p.active is true;
  if chosen_plan_id is null then
    if exists (
      select 1 from private.billing_plans p
      where p.monthly_fee = requested_fee
        and p.classes_per_month = target_classes_per_month
    ) then
      raise exception 'Este valor pertence a um plano legado desativado.';
    end if;
    insert into private.billing_plans (code, name, monthly_fee, classes_per_month, active, legacy)
    values (
      'administrative_' || (requested_fee * 100)::bigint::text || '_' || target_classes_per_month::text,
      'Administrativo — ' || requested_fee::text || ' / ' || target_classes_per_month::text || ' aulas',
      requested_fee, target_classes_per_month::smallint, true, false
    )
    on conflict (monthly_fee, classes_per_month) do nothing
    returning id into chosen_plan_id;
    if chosen_plan_id is null then
      select p.id into chosen_plan_id from private.billing_plans p
      where p.monthly_fee = requested_fee
        and p.classes_per_month = target_classes_per_month
        and p.active is true;
    end if;
  end if;
  if chosen_plan_id is null then
    raise exception 'Não foi possível configurar o plano financeiro.';
  end if;

  insert into public.profiles (
    id, name, email, whatsapp, enrolled, profile_completed, class_type,
    enrolled_at, tuition_due_day, tuition_due_day_anchor_date,
    tuition_due_day_selected_at, tuition_first_due_date,
    tuition_due_day_source, access_mode
  ) values (
    target_user_id, normalized_name, normalized_email,
    nullif(btrim(target_whatsapp), ''), true, true,
    case chosen_class.class_type when 'individual' then 'INDIVIDUAL' else 'QUINTETO' end,
    now(), target_due_day::smallint, today_local,
    now(), target_first_due_date, 'admin', 'administrative'
  );

  insert into public.class_students (class_number, user_id, first_lesson_date)
  values (target_class_number, target_user_id, target_first_lesson_date)
  returning id into membership_id;
  -- The default first-lesson trigger calculates the upcoming occurrence for
  -- self-enrollment; this explicit teacher-selected date is authoritative.
  update public.class_students
  set first_lesson_date = target_first_lesson_date
  where id = membership_id;

  insert into public.student_billing_settings (
    student_id, monthly_fee, due_day, billing_start_month, active,
    updated_by, classes_per_month, billing_plan_id
  ) values (
    target_user_id, requested_fee, target_due_day::smallint,
    date_trunc('month', target_first_due_date)::date,
    true, target_actor_id, target_classes_per_month::smallint, chosen_plan_id
  );
  tuition_id := private.ensure_first_tuition_for_student(
    target_user_id, target_first_due_date
  );
  if tuition_id is null then
    raise exception 'Não foi possível gerar a primeira mensalidade.';
  end if;

  return jsonb_build_object(
    'ok', true, 'student_id', target_user_id,
    'class_number', target_class_number,
    'first_lesson_date', target_first_lesson_date,
    'first_due_date', target_first_due_date,
    'tuition_id', tuition_id, 'access_mode', 'administrative'
  );
end;
$function$;

revoke all on function public.create_teacher_administrative_student_internal(
  uuid, uuid, text, text, text, integer, date, numeric, integer, integer, date
) from public, anon, authenticated;
grant execute on function public.create_teacher_administrative_student_internal(
  uuid, uuid, text, text, text, integer, date, numeric, integer, integer, date
) to service_role;

-- A limited, teacher-only lookup supports reporting without changing
-- the established get_teacher_students() return contract.
create or replace function public.get_teacher_administrative_student_ids()
returns table(student_id uuid)
language sql stable security definer set search_path = ''
as $function$
  select p.id from public.profiles p
  where p.access_mode = 'administrative'
    and p.enrolled is true and p.archived is false
    and public.is_teacher_admin();
$function$;
revoke all on function public.get_teacher_administrative_student_ids()
  from public, anon;
grant execute on function public.get_teacher_administrative_student_ids()
  to authenticated, service_role;

notify pgrst, 'reload schema';

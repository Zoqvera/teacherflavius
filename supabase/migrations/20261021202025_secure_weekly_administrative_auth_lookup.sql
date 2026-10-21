-- Narrow privileged authentication lookup; service_role cannot read auth.users.
-- This helper is unavailable to anon/authenticated and never exposes auth rows.
create or replace function private.is_banned_administrative_identity(
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists(
    select 1 from auth.users u
    where u.id = target_user_id
      and u.email = ('student-' || target_user_id::text || '@administrativo.teacherflavius.com')
      and u.banned_until > now()
      and u.deleted_at is null
  );
$function$;
revoke all on function private.is_banned_administrative_identity(uuid)
  from public, anon, authenticated;
grant execute on function private.is_banned_administrative_identity(uuid)
  to service_role;

CREATE OR REPLACE FUNCTION public.create_teacher_administrative_weekly_student_internal(target_user_id uuid, target_actor_id uuid, target_name text, target_whatsapp text, target_contact_email text, target_weekly_fee numeric, target_first_due_date date, target_classes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if not private.is_banned_administrative_identity(target_user_id) then
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

-- The public wrapper remains service-only and runs with invoker privileges.
revoke all on function public.create_teacher_administrative_weekly_student_internal(uuid,uuid,text,text,text,numeric,date,jsonb) from public,anon,authenticated;
grant execute on function public.create_teacher_administrative_weekly_student_internal(uuid,uuid,text,text,text,numeric,date,jsonb) to service_role;
notify pgrst, 'reload schema';

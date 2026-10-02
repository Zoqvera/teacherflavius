-- Recovery overlay for QUINTETO capacity = 8.

alter table public.teacher_classes
  add column if not exists capacity_override smallint;

alter table public.teacher_classes
  drop constraint if exists teacher_classes_capacity_override_range;

alter table public.teacher_classes
  add constraint teacher_classes_capacity_override_range
  check (capacity_override is null or capacity_override between 1 and 50);

update public.teacher_classes
set capacity_override = 8,
    updated_at = now()
where class_type = 'quintet'
  and capacity_override is distinct from 8;

create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when tc.class_type = 'quintet' then 8
    else coalesce(
      tc.capacity_override::integer,
      case
        when tc.class_type = 'individual' then 1
        when tc.class_type = 'quartet' then 5
        when tc.class_type = 'eight_students' then 8
        else null
      end
    )
  end
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

revoke all on function private.get_class_operational_capacity(integer)
  from public, anon, authenticated;
grant execute on function private.get_class_operational_capacity(integer)
  to service_role;

create or replace function public.create_teacher_class_with_type__mfa_inner(
  target_class_name text,
  target_class_type text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  next_number integer;
  next_order integer;
  final_name text;
  normalized_type text;
  inserted_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  normalized_type := lower(trim(coalesce(target_class_type, '')));
  if normalized_type not in ('quartet','quintet','individual','eight_students') then
    raise exception 'Tipo de turma inválido. Use quartet, quintet, individual ou eight_students.';
  end if;

  select coalesce(max(class_number), 0) + 1 into next_number from public.teacher_classes;
  select coalesce(max(display_order), 0) + 1 into next_order from public.teacher_classes where is_active = true;
  final_name := coalesce(nullif(trim(target_class_name), ''), 'Turma ' || next_number);

  insert into public.teacher_classes (
    class_number,
    class_name,
    class_type,
    capacity_override,
    display_order,
    is_active
  )
  values (
    next_number,
    final_name,
    normalized_type,
    case when normalized_type = 'quintet' then 8 else null end,
    next_order,
    true
  )
  returning id into inserted_id;

  return jsonb_build_object(
    'ok', true,
    'id', inserted_id,
    'class_number', next_number,
    'class_name', final_name,
    'class_type', normalized_type
  );
end;
$function$;

create or replace function public.set_teacher_class_type__mfa_inner(
  target_class_number integer,
  target_class_type text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  normalized_type text;
  updated_name text;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  normalized_type := lower(trim(coalesce(target_class_type, '')));
  if normalized_type not in ('quartet','quintet','individual','eight_students') then
    raise exception 'Tipo de turma inválido. Use quartet, quintet, individual ou eight_students.';
  end if;

  update public.teacher_classes
     set class_type = normalized_type,
         capacity_override = case
           when normalized_type = 'quintet' then 8
           when class_type = 'quintet' then null
           else capacity_override
         end,
         updated_at = now()
   where class_number = target_class_number
     and is_active = true
  returning class_name into updated_name;

  if not found then
    raise exception 'Turma não encontrada.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'class_number', target_class_number,
    'class_name', updated_name,
    'class_type', normalized_type
  );
end;
$function$;

create or replace function public.get_group_classes_with_available_spots__mfa_inner()
returns table(
  class_number integer,
  class_name text,
  class_weekday smallint,
  class_start_time time without time zone,
  occupied_spots integer,
  available_spots integer
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  return query
  with class_counts as (
    select
      tc.class_number,
      tc.class_name,
      tc.class_weekday,
      tc.class_start_time,
      private.get_class_operational_capacity(tc.class_number)::integer as capacity_limit,
      count(cs.id) filter (
        where cs.invite_id is not null
           or (
             cs.user_id is not null
             and coalesce(p.enrolled, false) = true
             and coalesce(p.archived, false) = false
           )
      )::integer as occupied_spots
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
      and tc.class_type in ('quartet', 'quintet')
    group by tc.class_number, tc.class_name, tc.class_weekday, tc.class_start_time
  )
  select
    cc.class_number,
    cc.class_name,
    cc.class_weekday,
    cc.class_start_time,
    cc.occupied_spots,
    greatest(0, cc.capacity_limit - cc.occupied_spots)::integer
  from class_counts cc
  where cc.capacity_limit is not null
    and cc.occupied_spots < cc.capacity_limit
  order by (cc.capacity_limit - cc.occupied_spots) desc, cc.class_name asc, cc.class_number asc;
end;
$function$;

create or replace function public.get_public_quartet_vacancies()
returns table(
  class_number integer,
  class_weekday smallint,
  class_start_time time without time zone,
  available_spots integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  with class_counts as (
    select
      tc.class_number,
      tc.class_weekday,
      tc.class_start_time,
      private.get_class_operational_capacity(tc.class_number)::integer as capacity_limit,
      count(cs.id) filter (
        where cs.invite_id is not null
           or (
             cs.user_id is not null
             and coalesce(p.enrolled, false) = true
             and coalesce(p.archived, false) = false
           )
      )::integer as occupied_spots
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
      and tc.class_type in ('quartet', 'quintet')
      and tc.class_weekday is not null
      and tc.class_start_time is not null
      and tc.class_number <> 47
    group by tc.class_number, tc.class_weekday, tc.class_start_time
  )
  select
    cc.class_number,
    cc.class_weekday,
    cc.class_start_time,
    greatest(0, cc.capacity_limit - cc.occupied_spots)::integer as available_spots
  from class_counts cc
  where cc.capacity_limit is not null
    and cc.occupied_spots > 1
    and cc.occupied_spots < cc.capacity_limit
  order by cc.class_weekday, cc.class_start_time, cc.class_number;
$function$;

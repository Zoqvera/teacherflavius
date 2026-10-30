
-- QUINTETO is a pedagogical label, not a fixed seat count.
-- Preserve the nine seats already authorized for the Monday 20h class.
update public.teacher_classes
set capacity_override = 9
where class_number = 47
  and is_active = true
  and class_type = 'quintet'
  and capacity_override = 7;

create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql stable security definer set search_path = ''
as $function$
  select case
    when tc.class_type = 'individual' then 1
    else coalesce(
      tc.capacity_override::integer,
      case when tc.class_type = 'experimental' then 30 else 8 end
    )
  end
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

create or replace function private.guard_teacher_class_capacity()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  capacity_limit integer;
  reserved_count integer;
begin
  if not coalesce(new.is_active, false) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73008, new.class_number);
  capacity_limit := case
    when new.class_type = 'individual' then 1
    else coalesce(new.capacity_override::integer,
      case when new.class_type = 'experimental' then 30 else 8 end)
  end;
  reserved_count := private.count_class_seat_members(new.class_number)
                  + private.count_class_seat_holds(new.class_number);

  if capacity_limit < reserved_count then
    raise exception
      'A capacidade da turma não pode ser menor que as % vagas já ocupadas ou reservadas.',
      reserved_count using errcode = '23514';
  end if;

  if new.class_type = 'individual'
     and new.capacity_override is not null and new.capacity_override <> 1 then
    raise exception 'Turmas individuais possuem capacidade de um aluno.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_teacher_class_capacity_trigger on public.teacher_classes;
create trigger guard_teacher_class_capacity_trigger
before update of capacity_override, class_type on public.teacher_classes
for each row execute function private.guard_teacher_class_capacity();

create or replace function public.save_teacher_class_configuration(
  target_class_number integer,
  target_class_type text,
  target_capacity integer,
  target_weekday smallint,
  target_start_time time without time zone
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  normalized_type text := lower(btrim(coalesce(target_class_type, '')));
  existing_id uuid;
  configured_name text;
  reserved_count integer;
begin
  if (select auth.uid()) is null
     or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;
  if normalized_type not in ('quintet', 'individual', 'experimental') then
    raise exception 'Tipo de turma inválido.' using errcode = '22023';
  end if;
  if target_capacity is null or target_capacity not between 1 and 50 then
    raise exception 'A capacidade deve ser de 1 a 50 alunos.' using errcode = '22023';
  end if;
  if normalized_type = 'individual' and target_capacity <> 1 then
    raise exception 'Turmas individuais possuem capacidade de um aluno.' using errcode = '22023';
  end if;
  if (target_weekday is null) <> (target_start_time is null)
    or (target_weekday is not null and target_weekday not between 1 and 7) then
    raise exception 'Informe dia e horário juntos, ou deixe ambos vazios.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73008, target_class_number);
  select tc.id, tc.class_name into existing_id, configured_name
  from public.teacher_classes tc
  where tc.class_number = target_class_number and tc.is_active = true
  for update;
  if not found then
    raise exception 'Turma ativa não encontrada.' using errcode = 'P0002';
  end if;

  reserved_count := private.count_class_seat_members(target_class_number)
                  + private.count_class_seat_holds(target_class_number);
  if target_capacity < reserved_count then
    raise exception
      'A turma possui % vagas ocupadas ou reservadas. A capacidade não pode ser menor.',
      reserved_count using errcode = '23514';
  end if;

  update public.teacher_classes
  set class_type = normalized_type,
      capacity_override = target_capacity,
      class_weekday = target_weekday,
      class_start_time = target_start_time
  where id = existing_id;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'class_number', target_class_number,
    'class_name', configured_name, 'class_type', normalized_type,
    'capacity', target_capacity
  );
end;
$function$;

revoke all on function public.save_teacher_class_configuration(integer,text,integer,smallint,time)
from public, anon;
grant execute on function public.save_teacher_class_configuration(integer,text,integer,smallint,time)
to authenticated;

-- Keep legacy configuration callers from resetting a custom QUINTETO capacity.
create or replace function public.set_teacher_class_type__mfa_inner(
  target_class_number integer,
  target_class_type text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  previous_type text;
  previous_capacity smallint;
  previous_weekday smallint;
  previous_start_time time without time zone;
  normalized_type text := lower(btrim(coalesce(target_class_type, '')));
  next_capacity integer;
begin
  if (select auth.uid()) is null
     or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;

  select tc.class_type, tc.capacity_override, tc.class_weekday, tc.class_start_time
  into previous_type, previous_capacity, previous_weekday, previous_start_time
  from public.teacher_classes tc
  where tc.class_number = target_class_number and tc.is_active = true;
  if not found then
    raise exception 'Turma ativa não encontrada.' using errcode = 'P0002';
  end if;

  next_capacity := case
    when normalized_type = 'individual' then 1
    when normalized_type = previous_type then
      coalesce(previous_capacity::integer,
        case when normalized_type = 'experimental' then 30 else 8 end)
    when normalized_type = 'experimental' then 30
    else 8
  end;

  return public.save_teacher_class_configuration(
    target_class_number, normalized_type, next_capacity,
    previous_weekday, previous_start_time
  );
end;
$function$;

-- New-class creation and initial custom capacity share one transaction.
create or replace function public.create_teacher_class_with_capacity(
  target_class_name text,
  target_class_type text,
  target_capacity integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  created jsonb;
  normalized_type text := lower(btrim(coalesce(target_class_type, '')));
begin
  if (select auth.uid()) is null
     or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;
  if target_capacity is null or target_capacity not between 1 and 50
     or (normalized_type = 'individual' and target_capacity <> 1) then
    raise exception 'Capacidade inválida para a modalidade escolhida.' using errcode = '22023';
  end if;

  created := public.create_teacher_class_with_type__mfa_inner(
    target_class_name, normalized_type
  );
  perform public.save_teacher_class_configuration(
    (created ->> 'class_number')::integer,
    normalized_type, target_capacity, null::smallint, null::time
  );
  return created || pg_catalog.jsonb_build_object('capacity', target_capacity);
end;
$function$;

revoke all on function public.create_teacher_class_with_capacity(text,text,integer)
from public, anon;
grant execute on function public.create_teacher_class_with_capacity(text,text,integer)
to authenticated;


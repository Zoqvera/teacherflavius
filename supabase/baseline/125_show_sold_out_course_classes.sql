-- Recovery overlay for sold-out class presentation on /aulas-em-grupo/.

drop function if exists public.get_public_course_vacancies();

create function public.get_public_course_vacancies()
returns table(
  class_number integer,
  class_weekday smallint,
  class_start_time time without time zone,
  class_type text,
  available_spots integer,
  sold_out boolean
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
      tc.class_type,
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
      and tc.class_type in ('quintet', 'individual')
      and tc.class_weekday is not null
      and tc.class_start_time is not null
      and upper(btrim(coalesce(tc.class_name, ''))) not like 'AULA EXPERIMENTAL%'
    group by
      tc.class_number,
      tc.class_weekday,
      tc.class_start_time,
      tc.class_type
  ),
  availability as (
    select
      cc.*,
      greatest(0, cc.capacity_limit - cc.occupied_spots)::integer as actual_available_spots
    from class_counts cc
    where cc.capacity_limit is not null
  )
  select
    a.class_number,
    a.class_weekday,
    a.class_start_time,
    a.class_type,
    case
      when a.class_type = 'quintet'
       and a.actual_available_spots between 1 and 3
        then a.actual_available_spots
      else 0
    end::integer as available_spots,
    case
      when a.class_type = 'individual' then true
      when a.actual_available_spots between 1 and 3 then false
      else true
    end as sold_out
  from availability a
  order by a.class_weekday, a.class_start_time, a.class_number;
$function$;

revoke all on function public.get_public_course_vacancies()
  from public, anon, authenticated;
grant execute on function public.get_public_course_vacancies()
  to anon, authenticated, service_role;

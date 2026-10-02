-- Recovery overlay for the /aulas-em-grupo/ vacancy visibility rule.

create or replace function public.get_public_course_vacancies()
returns table(
  class_number integer,
  class_weekday smallint,
  class_start_time time without time zone,
  available_spots integer
)
language sql
stable
security invoker
set search_path to ''
as $function$
  select
    vacancies.class_number,
    vacancies.class_weekday,
    vacancies.class_start_time,
    vacancies.available_spots
  from public.get_public_quartet_vacancies() as vacancies
  where vacancies.available_spots between 1 and 3
  order by vacancies.class_weekday, vacancies.class_start_time, vacancies.class_number;
$function$;

revoke all on function public.get_public_course_vacancies()
  from public, anon, authenticated;
grant execute on function public.get_public_course_vacancies()
  to anon, authenticated, service_role;

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
set search_path = public, pg_temp
as $$
  with class_counts as (
    select
      tc.class_number,
      tc.class_weekday,
      tc.class_start_time,
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
      and tc.class_type = 'quartet'
      and tc.class_weekday is not null
      and tc.class_start_time is not null
    group by tc.class_number, tc.class_weekday, tc.class_start_time
  )
  select
    cc.class_number,
    cc.class_weekday,
    cc.class_start_time,
    greatest(0, 4 - cc.occupied_spots)::integer as available_spots
  from class_counts cc
  where cc.occupied_spots > 1
    and cc.occupied_spots < 4
  order by cc.class_weekday, cc.class_start_time, cc.class_number;
$$;

revoke all on function public.get_public_quartet_vacancies() from public;
grant execute on function public.get_public_quartet_vacancies() to anon, authenticated;
comment on function public.get_public_quartet_vacancies() is
  'Public, non-PII vacancy summary for active quartet classes, capped at four students, with at least two occupied spots.';

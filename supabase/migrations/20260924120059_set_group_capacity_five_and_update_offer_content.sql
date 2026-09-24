create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when tc.class_type = 'individual' then 1
    when tc.class_type in ('quartet', 'quintet') then 5
    when tc.class_type = 'eight_students' then 8
    else null
  end
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

revoke all on function private.get_class_operational_capacity(integer)
  from public, anon, authenticated;
grant execute on function private.get_class_operational_capacity(integer)
  to service_role;

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
set search_path = ''
as $function$
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
    greatest(0, 5 - cc.occupied_spots)::integer as available_spots
  from class_counts cc
  where cc.occupied_spots > 1
    and cc.occupied_spots < 5
  order by cc.class_weekday, cc.class_start_time, cc.class_number;
$function$;

revoke all on function public.get_public_quartet_vacancies()
  from public, anon, authenticated;
grant execute on function public.get_public_quartet_vacancies()
  to anon, authenticated;

update public.page_content_overrides
set content = content || jsonb_build_object(
      'cta_text',
      'As turmas do Teacher Flávio têm até cinco alunos e aulas pela internet ao vivo.'
    ),
    updated_at = now()
where page_key = 'aula-particular-ou-em-grupo';

update public.page_content_overrides
set content = content || jsonb_build_object(
      'cta_text',
      'As aulas são ao vivo e organizadas em turmas de até cinco alunos, com material de apoio e orientação de estudos.'
    ),
    updated_at = now()
where page_key = 'aulas-de-ingles-em-grupos-pequenos';

update public.page_content_overrides
set content = content || jsonb_build_object(
      'small_group_title',
      'Por que turmas de até cinco alunos mudam a dinâmica?',
      'cta_text',
      'As aulas são ao vivo, em turmas de até cinco alunos, com material de apoio e orientação de estudos.'
    ),
    updated_at = now()
where page_key = 'como-funciona-aula-de-ingles-online-em-turma-pequena';

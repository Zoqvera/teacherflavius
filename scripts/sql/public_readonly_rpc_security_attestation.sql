-- Read-only production attestation for the three intentionally anonymous RPCs.
-- Any additional anonymous SECURITY DEFINER requires a new explicit review.
-- Never return student records, identities, or review text to the CI logs.
with approved_functions(oid, expected_result) as (
  values
    (
      'public.get_public_class_seat_availability()'::regprocedure,
      'TABLE(class_number integer, class_weekday smallint, class_start_time time without time zone, available_spots integer, sold_out boolean)'
    ),
    (
      'public.get_public_course_vacancies()'::regprocedure,
      'TABLE(class_number integer, class_weekday smallint, class_start_time time without time zone, class_type text, available_spots integer, sold_out boolean)'
    ),
    (
      'public.get_public_student_reviews(text)'::regprocedure,
      'jsonb'
    )
),
verified_definitions as (
  select
    count(*) = 3 as all_approved,
    bool_and(
      function_definition.prosecdef
      and function_definition.provolatile = 's'
      and function_definition.proconfig @> array['search_path=""']
      and pg_get_userbyid(function_definition.proowner) = 'postgres'
      and function_definition.proacl is not null
      and pg_get_function_result(function_definition.oid) = approved.expected_result
      and has_function_privilege('anon', function_definition.oid, 'EXECUTE')
      and has_function_privilege('authenticated', function_definition.oid, 'EXECUTE')
      and has_function_privilege('service_role', function_definition.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(function_definition.proacl) grant_record
        where grant_record.grantee = 0
          and grant_record.privilege_type = 'EXECUTE'
      )
    ) as definitions_safe
  from approved_functions approved
  join pg_proc function_definition on function_definition.oid = approved.oid
),
public_review_payloads as (
  select public.get_public_student_reviews('group') as payload
  union all
  select public.get_public_student_reviews('individual')
),
public_review_safety as (
  select
    count(*) = 2
    and bool_and(
      jsonb_typeof(payload) = 'object'
      and jsonb_typeof(payload->'reviews') = 'array'
      and jsonb_array_length(payload->'reviews') <= 5
      and (select count(*) from jsonb_object_keys(payload)) = 4
      and not exists (
        select 1
        from jsonb_object_keys(payload) as k(key)
        where k.key not in ('lesson_type','average_rating','total_reviews','reviews')
      )
      and not exists (
        select 1
        from jsonb_array_elements(payload->'reviews') as r(item)
        where jsonb_typeof(r.item) <> 'object'
          or (select count(*) from jsonb_object_keys(r.item)) <> 5
          or exists (
            select 1
            from jsonb_object_keys(r.item) as k(key)
            where k.key not in (
              'display_name','rating','comment','submitted_at','verified_student'
            )
          )
      )
    ) as payloads_safe
  from public_review_payloads
)
select (
  (select count(*) = 3 from approved_functions)
  and (select all_approved and definitions_safe from verified_definitions)
  and (
    select count(*) = 3
    from pg_proc function_definition
    join pg_namespace namespace
      on namespace.oid = function_definition.pronamespace
    where namespace.nspname = 'public'
      and function_definition.prosecdef
      and has_function_privilege('anon', function_definition.oid, 'EXECUTE')
  )
  and (
    select pg_get_functiondef('public.get_public_student_reviews(text)'::regprocedure)
      like '%review.status = ''approved''%'
  )
  and (
    select pg_get_functiondef('public.get_public_student_reviews(text)'::regprocedure)
      like '%review.publication_consent_at is not null%'
  )
  and (select payloads_safe from public_review_safety)
  and not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_table_privilege('anon', 'private.student_class_reviews', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'private.student_class_reviews', 'SELECT,INSERT,UPDATE,DELETE')
) as public_readonly_rpcs_attested;

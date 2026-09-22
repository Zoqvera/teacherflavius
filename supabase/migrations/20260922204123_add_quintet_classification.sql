alter table public.profiles
  drop constraint if exists profiles_class_type_check;

alter table public.profiles
  add constraint profiles_class_type_check
  check (
    class_type is null
    or class_type in ('INDIVIDUAL', 'QUARTETO', 'QUINTETO', '8 ALUNOS')
  );

alter table public.teacher_classes
  drop constraint if exists teacher_classes_class_type_check;

alter table public.teacher_classes
  add constraint teacher_classes_class_type_check
  check (
    class_type is null
    or class_type in ('individual', 'quartet', 'quintet', 'eight_students')
  );

create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when tc.class_type = 'individual' then 1
    when tc.class_type = 'quartet' and tc.class_number in (73, 75) then 5
    when tc.class_type = 'quartet' then 4
    when tc.class_type = 'quintet' then 5
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

do $migration$
declare
  item record;
  function_oid oid;
  current_definition text;
  updated_definition text;
begin
  for item in
    select *
    from (values
      (
        'public.create_teacher_class_with_type__mfa_inner(text,text)',
        'not in (''quartet'',''individual'',''eight_students'')',
        'not in (''quartet'',''quintet'',''individual'',''eight_students'')'
      ),
      (
        'public.create_teacher_class_with_type__mfa_inner(text,text)',
        'Use quartet, individual ou eight_students.',
        'Use quartet, quintet, individual ou eight_students.'
      ),
      (
        'public.set_teacher_class_type__mfa_inner(integer,text)',
        'not in (''quartet'',''individual'',''eight_students'')',
        'not in (''quartet'',''quintet'',''individual'',''eight_students'')'
      ),
      (
        'public.set_teacher_class_type__mfa_inner(integer,text)',
        'Use quartet, individual ou eight_students.',
        'Use quartet, quintet, individual ou eight_students.'
      ),
      (
        'public.add_teacher_class_student_by_ref__mfa_inner(integer,text,text)',
        'when ''QUARTETO'' then ''quartet''',
        'when ''QUARTETO'' then ''quartet'' when ''QUINTETO'' then ''quintet'''
      ),
      (
        'public.add_teacher_class_student_by_ref__mfa_inner(integer,text,text)',
        'when ''quartet'' then ''QUARTETO''',
        'when ''quartet'' then ''QUARTETO'' when ''quintet'' then ''QUINTETO'''
      ),
      (
        'public.get_available_group_classes_for_students()',
        'when ''QUARTETO'' then ''quartet''',
        'when ''QUARTETO'' then ''quartet'' when ''QUINTETO'' then ''quintet'''
      ),
      (
        'public.switch_my_group_class(integer)',
        'when ''QUARTETO'' then ''quartet''',
        'when ''QUARTETO'' then ''quartet'' when ''QUINTETO'' then ''quintet'''
      ),
      (
        'public.get_teacher_trial_lesson_classes()',
        '(''quartet'', ''eight_students'')',
        '(''quartet'', ''quintet'', ''eight_students'')'
      ),
      (
        'public.create_teacher_trial_lesson(text,text,text,text,date,time without time zone,integer)',
        '(''quartet'', ''eight_students'')',
        '(''quartet'', ''quintet'', ''eight_students'')'
      ),
      (
        'public.update_teacher_trial_lesson(uuid,text,text,text,text,date,time without time zone,integer)',
        '(''quartet'', ''eight_students'')',
        '(''quartet'', ''quintet'', ''eight_students'')'
      ),
      (
        'private.run_operational_data_quality_check(boolean)',
        'when ''QUARTETO'' then ''quartet''',
        'when ''QUARTETO'' then ''quartet'' when ''QUINTETO'' then ''quintet'''
      )
    ) as replacements(signature, old_fragment, new_fragment)
  loop
    function_oid := to_regprocedure(item.signature)::oid;
    if function_oid is null then
      raise exception 'Function not found: %', item.signature;
    end if;

    select pg_get_functiondef(function_oid) into current_definition;
    updated_definition := replace(current_definition, item.old_fragment, item.new_fragment);

    if updated_definition = current_definition then
      raise exception 'Expected fragment not found in %: %', item.signature, item.old_fragment;
    end if;

    execute updated_definition;
  end loop;
end
$migration$;

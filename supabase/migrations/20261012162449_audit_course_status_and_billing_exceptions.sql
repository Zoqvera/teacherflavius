-- Flag genuinely unexplained course/billing inconsistencies, not legitimate exceptions.
DO $adapt$
DECLARE before_definition text; after_definition text;
BEGIN
  SELECT pg_get_functiondef('private.run_operational_data_quality_check(boolean)'::regprocedure)
    INTO before_definition;
  after_definition := replace(before_definition,
    '  course_billing_contradictions integer := 0;',
    '  course_billing_contradictions integer := 0;' || E'\n' ||
    '  unjustified_inactive_student_billing integer := 0;' || E'\n' ||
    '  course_membership_state_conflicts integer := 0;');
  IF before_definition=after_definition THEN
    RAISE EXCEPTION 'Auditor: campo course_billing_contradictions não encontrado.';
  END IF;
  before_definition := after_definition;
  after_definition := replace(before_definition,
    '  select count(*)::integer into course_billing_contradictions',
    $sql$  select count(*)::integer into unjustified_inactive_student_billing
  from public.profiles p
  join public.student_billing_settings b on b.student_id=p.id
  left join public.student_course_states s on s.student_id=p.id
  where p.enrolled=true and coalesce(p.archived,false)=false
    and b.active=false
    and coalesce(s.course_status,'') <> 'paused'
    and coalesce(s.billing_exemption,'none') <> 'permanent';

  select count(*)::integer into course_membership_state_conflicts
  from public.student_course_states s
  join public.profiles p on p.id=s.student_id
  cross join lateral (
    select count(*) as class_count from public.class_students cs
    join public.teacher_classes tc on tc.class_number=cs.class_number
    where cs.user_id=s.student_id and tc.is_active=true
      and tc.class_type in ('quintet','individual')
  ) members
  where p.enrolled=true and coalesce(p.archived,false)=false
    and ((s.course_status='active' and members.class_count=0)
      or (s.course_status in ('paused','awaiting_class') and members.class_count>0));

  select count(*)::integer into course_billing_contradictions$sql$);
  IF before_definition=after_definition THEN
    RAISE EXCEPTION 'Auditor: consulta course_billing_contradictions não encontrada.';
  END IF;
  before_definition := after_definition;
  after_definition := replace(before_definition,
    '  if course_billing_contradictions > 0 then',
    $sql$  if unjustified_inactive_student_billing > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_inactive_student_billing_without_exception',
      'warning',jsonb_build_object('count',unjustified_inactive_student_billing));
  end if;
  if course_membership_state_conflicts > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_course_membership_state_conflict',
      'warning',jsonb_build_object('count',course_membership_state_conflicts));
  end if;
  if course_billing_contradictions > 0 then$sql$);
  IF before_definition=after_definition THEN
    RAISE EXCEPTION 'Auditor: seção de issues não encontrada.';
  END IF;
  before_definition := after_definition;
  after_definition := replace(before_definition,
    '''course_billing_contradictions'',course_billing_contradictions,',
    $sql$'course_billing_contradictions',course_billing_contradictions,
    'unjustified_inactive_student_billing',unjustified_inactive_student_billing,
    'course_membership_state_conflicts',course_membership_state_conflicts,$sql$);
  IF before_definition=after_definition THEN
    RAISE EXCEPTION 'Auditor: métricas não encontradas.';
  END IF;
  EXECUTE after_definition;
END;
$adapt$;
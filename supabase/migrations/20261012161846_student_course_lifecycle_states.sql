
-- Course situation is independent of the commercial class type and of payment history.
CREATE TABLE IF NOT EXISTS public.student_course_states (
  student_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_status text NOT NULL CHECK (course_status IN ('active','awaiting_class','paused')),
  status_since date,
  status_reason text,
  billing_exemption text NOT NULL DEFAULT 'none' CHECK (billing_exemption IN ('none','permanent')),
  billing_block_from_month date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT paused_blocks_billing CHECK (
    (course_status = 'paused' AND billing_block_from_month IS NOT NULL)
    OR (course_status <> 'paused' AND billing_block_from_month IS NULL)
  ),
  CONSTRAINT block_month_is_first CHECK (
    billing_block_from_month IS NULL
    OR billing_block_from_month = date_trunc('month',billing_block_from_month)::date
  )
);
ALTER TABLE public.student_course_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Professores gerenciam estados administrativos" ON public.student_course_states;
CREATE POLICY "Professores gerenciam estados administrativos"
ON public.student_course_states FOR ALL TO authenticated
USING (public.is_teacher_admin()) WITH CHECK (public.is_teacher_admin());
GRANT SELECT, INSERT, UPDATE ON public.student_course_states TO authenticated;

-- Administrative summary uses only verified enrollments and current active class membership.
CREATE OR REPLACE FUNCTION public.get_teacher_student_course_states()
RETURNS TABLE (
  student_id uuid, course_status text, status_since date, status_reason text,
  billing_exemption text, billing_block_from_month date, active_class_count bigint,
  billing_active boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT public.is_teacher_admin() THEN
    RAISE EXCEPTION 'Acesso administrativo necessário.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id,
    COALESCE(s.course_status, CASE WHEN memberships.cnt > 0 THEN 'active' ELSE 'awaiting_class' END),
    s.status_since, s.status_reason,
    COALESCE(s.billing_exemption,'none'),
    s.billing_block_from_month, memberships.cnt, b.active
  FROM public.profiles p
  LEFT JOIN public.student_course_states s ON s.student_id = p.id
  LEFT JOIN public.student_billing_settings b ON b.student_id = p.id
  CROSS JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.class_students cs
    JOIN public.teacher_classes tc ON tc.class_number = cs.class_number
    WHERE cs.user_id = p.id AND tc.is_active = true AND tc.class_type IN ('quintet','individual')
  ) memberships
  WHERE p.enrolled IS TRUE AND COALESCE(p.archived,false) IS FALSE
    AND NOT EXISTS (
      SELECT 1 FROM public.teacher_admins admin WHERE admin.user_id = p.id
    );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_teacher_student_course_states() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_student_course_states() TO authenticated;

-- Explicit transitions: paused -> charge suspended; awaiting -> charge preserved;
-- active -> only with a real class. Exemption applies independently.
CREATE OR REPLACE FUNCTION public.set_teacher_student_course_state(
  target_student_id uuid,
  target_course_status text,
  target_reason text DEFAULT NULL,
  target_billing_exemption text DEFAULT NULL,
  target_effective_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  member_count bigint;
  exemption_value text;
  was_paused boolean;
  billing_row public.student_billing_settings%rowtype;
  today_local date := (now() at time zone 'America/Sao_Paulo')::date;
  next_due date;
BEGIN
  IF NOT public.is_teacher_admin() THEN
    RAISE EXCEPTION 'Acesso administrativo necessário.' USING ERRCODE = '42501';
  END IF;
  IF target_course_status NOT IN ('active','awaiting_class','paused') OR target_course_status IS NULL THEN
    RAISE EXCEPTION 'Situação administrativa inválida.';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id = target_student_id
    AND enrolled IS TRUE AND COALESCE(archived,false) IS FALSE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aluno matriculado ativo não encontrado.'; END IF;
  SELECT count(*) INTO member_count FROM public.class_students cs
  JOIN public.teacher_classes tc ON tc.class_number = cs.class_number
  WHERE cs.user_id = target_student_id AND tc.is_active = true
    AND tc.class_type IN ('quintet','individual');
  IF target_course_status = 'active' AND member_count = 0 THEN
    RAISE EXCEPTION 'A situação Ativo com turma exige vínculo com turma regular ativa.';
  END IF;
  IF target_course_status <> 'active' AND member_count > 0 THEN
    RAISE EXCEPTION 'Desvincule primeiro o aluno das turmas regulares para usar esta situação.';
  END IF;
  SELECT COALESCE(target_billing_exemption, s.billing_exemption, 'none'),
         COALESCE(s.course_status = 'paused',false)
  INTO exemption_value, was_paused
  FROM (SELECT 1) singleton
  LEFT JOIN public.student_course_states s ON s.student_id = target_student_id;
  IF exemption_value NOT IN ('none','permanent') THEN
    RAISE EXCEPTION 'Tipo de isenção inválido.';
  END IF;
  IF (target_course_status = 'paused' OR exemption_value = 'permanent')
    AND NULLIF(trim(COALESCE(target_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da pausa ou isenção.';
  END IF;
  SELECT * INTO billing_row FROM public.student_billing_settings
    WHERE student_id = target_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configure a mensalidade antes de alterar a situação.'; END IF;

  INSERT INTO public.student_course_states (
    student_id, course_status, status_since, status_reason,
    billing_exemption, billing_block_from_month, updated_at, updated_by
  ) VALUES (
    target_student_id, target_course_status,
    COALESCE(target_effective_date,today_local), NULLIF(trim(target_reason),''),
    exemption_value,
    CASE WHEN target_course_status='paused'
      THEN date_trunc('month',COALESCE(target_effective_date,today_local))::date ELSE NULL END,
    now(), auth.uid()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    course_status = EXCLUDED.course_status,
    status_since = EXCLUDED.status_since,
    status_reason = EXCLUDED.status_reason,
    billing_exemption = EXCLUDED.billing_exemption,
    billing_block_from_month = EXCLUDED.billing_block_from_month,
    updated_at = now(), updated_by = auth.uid();

  IF target_course_status = 'paused' OR exemption_value = 'permanent' THEN
    UPDATE public.student_billing_settings SET active=false,updated_at=now(),updated_by=auth.uid()
      WHERE student_id=target_student_id;
  ELSE
    IF was_paused THEN
      next_due := public.first_tuition_due_date_after(today_local,billing_row.due_day);
      UPDATE public.student_billing_settings
      SET active=true, billing_start_month=date_trunc('month',next_due)::date,
          updated_at=now(),updated_by=auth.uid()
      WHERE student_id=target_student_id;
    ELSE
      UPDATE public.student_billing_settings SET active=true,updated_at=now(),updated_by=auth.uid()
        WHERE student_id=target_student_id;
    END IF;
    UPDATE public.profiles p
    SET tuition_first_due_date = COALESCE(p.tuition_first_due_date,
      public.first_tuition_due_date_after(today_local,billing_row.due_day))
    WHERE id=target_student_id AND tuition_first_due_date IS NULL;
  END IF;
  RETURN jsonb_build_object('student_id',target_student_id,'status',target_course_status,
    'billing_exemption',exemption_value,'billing_active',
    target_course_status<>'paused' AND exemption_value<>'permanent');
END;
$function$;
REVOKE ALL ON FUNCTION public.set_teacher_student_course_state(uuid,text,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_teacher_student_course_state(uuid,text,text,text,date) TO authenticated;

-- Changes of class allocation maintain the independent course state.
CREATE OR REPLACE FUNCTION private.sync_course_state_after_class_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  ref_student uuid;
  previous_status text;
  exemption_value text;
  due_day_value smallint;
  next_due date;
  today_local date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  ref_student := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  IF ref_student IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=ref_student AND enrolled=true AND COALESCE(archived,false)=false
  ) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teacher_classes
      WHERE class_number=NEW.class_number AND is_active=true AND class_type IN ('quintet','individual')
    ) THEN RETURN NULL; END IF;
    SELECT course_status,billing_exemption INTO previous_status,exemption_value
      FROM public.student_course_states WHERE student_id=ref_student FOR UPDATE;
    IF previous_status IN ('paused','awaiting_class') THEN
      UPDATE public.student_course_states SET course_status='active',
        status_since=today_local, status_reason= CASE
          WHEN previous_status='paused' THEN 'Retomada automática após vínculo com turma'
          ELSE 'Vinculado a turma regular ativa' END,
        billing_block_from_month=NULL,updated_at=now(),updated_by=auth.uid()
      WHERE student_id=ref_student;
      IF previous_status='paused' AND exemption_value<>'permanent' THEN
        SELECT due_day INTO due_day_value FROM public.student_billing_settings
          WHERE student_id=ref_student;
        IF due_day_value IS NOT NULL THEN
          next_due := public.first_tuition_due_date_after(today_local,due_day_value);
          UPDATE public.profiles SET tuition_first_due_date =
            COALESCE(tuition_first_due_date,next_due) WHERE id=ref_student;
          UPDATE public.student_billing_settings
          SET active=true,billing_start_month=date_trunc('month',next_due)::date,
            updated_at=now(),updated_by=auth.uid() WHERE student_id=ref_student;
        END IF;
      END IF;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.class_students cs
      JOIN public.teacher_classes tc ON tc.class_number=cs.class_number
      WHERE cs.user_id=ref_student AND tc.is_active=true AND tc.class_type IN ('quintet','individual')
    ) THEN
      UPDATE public.student_course_states SET course_status='awaiting_class',
        status_since=today_local,status_reason='Aguardando nova turma após desvinculação',
        updated_at=now(),updated_by=auth.uid()
      WHERE student_id=ref_student AND course_status='active';
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.sync_course_state_after_class_assignment() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sync_course_state_on_class_membership ON public.class_students;
CREATE TRIGGER sync_course_state_on_class_membership
AFTER INSERT OR DELETE ON public.class_students
FOR EACH ROW EXECUTE FUNCTION private.sync_course_state_after_class_assignment();

-- Independently deny re-enabling suspended or permanently exempt billing.
CREATE OR REPLACE FUNCTION private.prevent_invalid_student_billing_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NEW.active=true AND EXISTS (
    SELECT 1 FROM public.student_course_states s
    WHERE s.student_id=NEW.student_id
      AND (s.course_status='paused' OR s.billing_exemption='permanent')
  ) THEN
    RAISE EXCEPTION 'Cobrança bloqueada: matrícula pausada ou isenção permanente.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.prevent_invalid_student_billing_activation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prevent_invalid_student_billing_activation ON public.student_billing_settings;
CREATE TRIGGER prevent_invalid_student_billing_activation
BEFORE INSERT OR UPDATE OF active ON public.student_billing_settings
FOR EACH ROW EXECUTE FUNCTION private.prevent_invalid_student_billing_activation();

-- Charge generation and manual inserts cannot defeat a paused/exempt state.
CREATE OR REPLACE FUNCTION private.prevent_new_tuition_during_student_pause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_course_states s
    WHERE s.student_id=NEW.student_id
      AND (
        (s.course_status='paused' AND NEW.reference_month>=s.billing_block_from_month)
        OR (s.billing_exemption='permanent' AND COALESCE(NEW.is_exempt,false)=false)
      )
  ) THEN
    RAISE EXCEPTION 'Mensalidade impedida: pausa ou isenção permanente vigente.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.prevent_new_tuition_during_student_pause() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS prevent_new_tuition_during_student_pause ON public.monthly_tuition;
CREATE TRIGGER prevent_new_tuition_during_student_pause
BEFORE INSERT OR UPDATE OF student_id,reference_month ON public.monthly_tuition
FOR EACH ROW EXECUTE FUNCTION private.prevent_new_tuition_during_student_pause();

-- Backfill only explicitly confirmed decisions. Historical charge/payment rows are untouched.
INSERT INTO public.student_course_states (
  student_id,course_status,status_since,status_reason,billing_exemption,billing_block_from_month
) VALUES
 ('4a3cc9d7-be91-4279-90aa-0efd7787892e','awaiting_class','2026-10-12',
  'Manter matrícula e mensalidade de outubro devidas. Não realocar automaticamente.','none',NULL),
 ('be7385c5-934e-4d5e-8786-bb0095489a93','awaiting_class','2026-10-12',
  'Manter matrícula e primeira mensalidade devidas. Não realocar automaticamente.','none',NULL),
 ('ce3672fc-ec98-476b-a2cb-ce9a2b396c13','paused',NULL,
  'Viagem. Pausa desde o desvinculamento; data exata do desvinculamento não disponível no histórico. Não cobrar competências a partir de outubro/2026.','none','2026-10-01'),
 ('3f08a406-1f7a-4df8-ab43-79d360518880','active','2026-10-12',
  'Isenção permanente de mensalidades autorizada.','permanent',NULL)
ON CONFLICT (student_id) DO UPDATE SET
  course_status=EXCLUDED.course_status,status_since=EXCLUDED.status_since,
  status_reason=EXCLUDED.status_reason,billing_exemption=EXCLUDED.billing_exemption,
  billing_block_from_month=EXCLUDED.billing_block_from_month,updated_at=now();

-- Keep the original, legitimate fee states exactly as recorded.
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_course_states s
    JOIN public.student_billing_settings b ON b.student_id=s.student_id
    WHERE (s.course_status='paused' OR s.billing_exemption='permanent') AND b.active=true
  ) THEN
    RAISE EXCEPTION 'Uma matrícula pausada ou isenta permanece com cobrança ativa.';
  END IF;
END;
$check$;

-- New operational metrics distinguish legitimate exemptions and pauses
-- from dangerous active billing inconsistencies.
DO $adapt$
DECLARE original_definition text; changed_definition text;
BEGIN
  SELECT pg_get_functiondef('private.run_operational_data_quality_check(boolean)'::regprocedure)
    INTO original_definition;
  changed_definition := replace(original_definition,
    '  active_billing_missing_first_due integer := 0;',
    '  active_billing_missing_first_due integer := 0;' || E'\n' ||
    '  course_billing_contradictions integer := 0;');
  IF changed_definition=original_definition THEN
    RAISE EXCEPTION 'Não foi possível localizar a declaração do auditor operacional.';
  END IF;
  original_definition := changed_definition;
  changed_definition := replace(original_definition,
    '  select count(*)::integer into active_billing_missing_first_due',
    $fragment$  select count(*)::integer into course_billing_contradictions
  from public.student_course_states s
  join public.student_billing_settings b on b.student_id=s.student_id
  where (s.course_status='paused' or s.billing_exemption='permanent') and b.active=true;

  select count(*)::integer into active_billing_missing_first_due$fragment$);
  IF changed_definition=original_definition THEN
    RAISE EXCEPTION 'Não foi possível localizar a verificação de cobrança no auditor.';
  END IF;
  original_definition := changed_definition;
  changed_definition := replace(original_definition,
    '  if active_billing_missing_first_due > 0 then',
    $fragment$  if course_billing_contradictions > 0 then
    insert into pg_temp.operational_data_quality_issues
    values ('data_quality_course_billing_contradiction','warning',
      jsonb_build_object('count',course_billing_contradictions));
  end if;
  if active_billing_missing_first_due > 0 then$fragment$);
  IF changed_definition=original_definition THEN
    RAISE EXCEPTION 'Não foi possível localizar a seção de alertas do auditor.';
  END IF;
  original_definition := changed_definition;
  changed_definition := replace(original_definition,
    '''active_billing_missing_first_due'',active_billing_missing_first_due,',
    $fragment$'active_billing_missing_first_due',active_billing_missing_first_due,
    'course_billing_contradictions',course_billing_contradictions,
    'course_paused_students_info',(select count(*) from public.student_course_states where course_status='paused'),
    'course_awaiting_class_students_info',(select count(*) from public.student_course_states where course_status='awaiting_class'),
    'permanent_tuition_exempt_students_info',(select count(*) from public.student_course_states where billing_exemption='permanent'),$fragment$);
  IF changed_definition=original_definition THEN
    RAISE EXCEPTION 'Não foi possível localizar as métricas no auditor.';
  END IF;
  EXECUTE changed_definition;
END;
$adapt$;

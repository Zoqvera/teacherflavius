-- ETAPA 5: incorpora produções e feedbacks Homeworks à exportação LGPD existente.
-- Não inclui gabaritos, tokens de avaliação, custos de infraestrutura ou dados de terceiros.
-- Preserva assinatura, autenticação, permissões e campos legados da RPC.
-- Não define nem modifica política de retenção e não libera TAREFAS PARA CASA.

CREATE OR REPLACE FUNCTION public.get_my_data_export()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'storage', 'pg_temp'
AS $function$
declare
  requester_id uuid := auth.uid();
  result jsonb;
begin
  if requester_id is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'format_version', '1.0',
    'exported_at', now(),
    'scope_note', 'Cópia automática dos principais dados diretamente associados à conta. Payloads técnicos extensos, segredos operacionais e conteúdo de terceiros não são incluídos automaticamente e podem ser objeto de solicitação formal de acesso.',
    'account', (
      select jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'phone', u.phone,
        'created_at', u.created_at,
        'updated_at', u.updated_at,
        'last_sign_in_at', u.last_sign_in_at,
        'email_confirmed_at', u.email_confirmed_at,
        'user_metadata', coalesce(u.raw_user_meta_data, '{}'::jsonb)
      )
      from auth.users u where u.id = requester_id
    ),
    'identities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', i.provider,
        'provider_id', i.provider_id,
        'email', i.email,
        'created_at', i.created_at,
        'updated_at', i.updated_at,
        'last_sign_in_at', i.last_sign_in_at
      ) order by i.created_at)
      from auth.identities i where i.user_id = requester_id
    ), '[]'::jsonb),
    'profile', (
      select jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'email', p.email,
        'created_at', p.created_at,
        'cpf', p.cpf,
        'whatsapp', p.whatsapp,
        'enrollment_code', p.enrollment_code,
        'enrolled', p.enrolled,
        'pix_key', p.pix_key,
        'availability', p.availability,
        'exercise_schedule_start_date', p.exercise_schedule_start_date,
        'archived', p.archived,
        'archived_at', p.archived_at,
        'class_type', p.class_type,
        'profile_completed', p.profile_completed,
        'first_portal_access_at', p.first_portal_access_at,
        'last_portal_access_at', p.last_portal_access_at,
        'date_of_birth', p.date_of_birth
      ) from public.profiles p where p.id = requester_id
    ),
    'private_data', (
      select to_jsonb(spd) from public.student_private_data spd where spd.user_id = requester_id
    ),
    'enrollment_records', coalesce((
      select jsonb_agg(to_jsonb(se) order by se.created_at)
      from public.student_enrollments se where se.user_id = requester_id
    ), '[]'::jsonb),
    'class_memberships', coalesce((
      select jsonb_agg(to_jsonb(cs) order by cs.created_at)
      from public.class_students cs where cs.user_id = requester_id
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(to_jsonb(sf) order by sf.class_date)
      from public.student_frequency sf where sf.user_id = requester_id
    ), '[]'::jsonb),
    'activity_results', coalesce((
      select jsonb_agg(to_jsonb(ar) order by ar.completed_at)
      from public.activity_results ar where ar.user_id = requester_id
    ), '[]'::jsonb),
    'daily_exercise_completion', coalesce((
      select jsonb_agg(to_jsonb(dec) - 'completed_by' - 'completed_by_email' order by dec.created_at)
      from public.daily_exercise_completion dec where dec.user_id = requester_id
    ), '[]'::jsonb),
    'grammar_lesson_completion', coalesce((
      select jsonb_agg(to_jsonb(glc) order by glc.updated_at)
      from public.grammar_lesson_completion glc where glc.user_id = requester_id
    ), '[]'::jsonb),
    'study_roadmap_completion', coalesce((
      select jsonb_agg(to_jsonb(src) order by src.updated_at)
      from public.study_roadmap_completion src where src.user_id = requester_id
    ), '[]'::jsonb),
    'weekly_tasks', coalesce((
      select jsonb_agg(to_jsonb(wst) - 'created_by' order by wst.created_at)
      from public.weekly_student_tasks wst where wst.user_id = requester_id
    ), '[]'::jsonb),
    'weekly_plan_snapshots', coalesce((
      select jsonb_agg(to_jsonb(wps) order by wps.created_at)
      from public.weekly_plan_snapshots wps where wps.user_id = requester_id
    ), '[]'::jsonb),
    'flashcard_decks', coalesce((
      select jsonb_agg(to_jsonb(fd) order by fd.created_at)
      from public.flashcard_decks fd where fd.owner_id = requester_id
    ), '[]'::jsonb),
    'flashcards', coalesce((
      select jsonb_agg(to_jsonb(fc) order by fc.deck_id, fc.position)
      from public.flashcards fc
      join public.flashcard_decks fd on fd.id = fc.deck_id
      where fd.owner_id = requester_id
    ), '[]'::jsonb),
    'flashcard_practice_days', coalesce((
      select jsonb_agg(to_jsonb(fpd) order by fpd.practice_date)
      from public.flashcard_practice_days fpd where fpd.user_id = requester_id
    ), '[]'::jsonb),
    'flashcard_review_history', coalesce((
      select jsonb_agg(to_jsonb(frh) order by frh.reviewed_at)
      from public.flashcard_review_history frh where frh.user_id = requester_id
    ), '[]'::jsonb),
    'flashcard_srs', coalesce((
      select jsonb_agg(to_jsonb(fs) order by fs.updated_at)
      from public.flashcard_srs fs where fs.user_id = requester_id
    ), '[]'::jsonb),
    'makeup_class_bookings', coalesce((
      select jsonb_agg(to_jsonb(mcb) order by mcb.booked_at)
      from public.makeup_class_bookings mcb where mcb.student_id = requester_id
    ), '[]'::jsonb),
    'pronunciation_attempts', coalesce((
      select jsonb_agg(to_jsonb(pa) - 'azure_result' order by pa.created_at)
      from public.pronunciation_attempts pa where pa.user_id = requester_id
    ), '[]'::jsonb),
    'access_logs', coalesce((
      select jsonb_agg(to_jsonb(sal) order by sal.accessed_at)
      from public.student_access_logs sal where sal.user_id = requester_id
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(to_jsonb(st) - 'created_by' order by st.created_at)
      from public.student_tags st where st.user_id = requester_id
    ), '[]'::jsonb),
    'exercise_sync_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ese.id,
        'received_at', ese.received_at,
        'status', ese.status,
        'exercise_id', ese.exercise_id,
        'exercise_title', ese.exercise_title,
        'source_email', ese.source_email,
        'student_name', ese.student_name,
        'submitted_completed_at', ese.submitted_completed_at,
        'stored_completed_at', ese.stored_completed_at,
        'record_action', ese.record_action,
        'error_message', ese.error_message
      ) order by ese.received_at)
      from public.exercise_sync_events ese where ese.user_id = requester_id
    ), '[]'::jsonb),
    'homework_assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id,
        'exercise_id', a.exercise_id,
        'activity_type', e.activity_type,
        'status', a.status,
        'due_at', a.due_at,
        'created_at', a.created_at,
        'attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'attempt_id', t.id,
            'attempt_number', t.attempt_number,
            'status', t.status,
            'score', t.score,
            'started_at', t.started_at,
            'submitted_at', t.submitted_at,
            'evaluated_at', t.evaluated_at,
            'answers', coalesce((
              select jsonb_agg(jsonb_build_object(
                'answer_id', an.id,
                'question_id', an.question_id,
                'answer', an.answer,
                'score', an.score,
                'saved_at', an.saved_at
              ) order by an.saved_at, an.id)
              from public.exercise_answers an
              where an.attempt_id = t.id
            ), '[]'::jsonb),
            'feedback', coalesce((
              select jsonb_agg(jsonb_build_object(
                'feedback_id', f.id,
                'source', f.source,
                'score', f.score,
                'general_comment', f.general_comment,
                'original_text', f.original_text,
                'corrected_text', f.corrected_text,
                'explanations', f.explanations,
                'evaluator_model', f.evaluator_model,
                'created_at', f.created_at
              ) order by f.created_at, f.id)
              from public.exercise_feedback f
              where f.attempt_id = t.id
            ), '[]'::jsonb)
          ) order by t.started_at, t.id)
          from public.exercise_attempts t
          where t.assignment_id = a.id and t.student_id = requester_id
        ), '[]'::jsonb)
      ) order by a.created_at, a.id)
      from public.exercise_assignments a
      join public.exercises e on e.id = a.exercise_id
      where a.student_id = requester_id
    ), '[]'::jsonb),
    'billing_settings', (
      select to_jsonb(sbs) - 'updated_by'
      from public.student_billing_settings sbs where sbs.student_id = requester_id
    ),
    'monthly_tuition', coalesce((
      select jsonb_agg(to_jsonb(mt) - 'created_by' - 'updated_by' order by mt.reference_month)
      from public.monthly_tuition mt where mt.student_id = requester_id
    ), '[]'::jsonb),
    'payment_attempts', coalesce((
      select jsonb_agg(to_jsonb(tpa) - 'idempotency_key' order by tpa.created_at)
      from public.tuition_payment_attempts tpa where tpa.student_id = requester_id
    ), '[]'::jsonb),
    'storage_files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket_id', so.bucket_id,
        'name', so.name,
        'created_at', so.created_at,
        'updated_at', so.updated_at,
        'metadata', so.metadata
      ) order by so.created_at)
      from storage.objects so where so.owner = requester_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$
;
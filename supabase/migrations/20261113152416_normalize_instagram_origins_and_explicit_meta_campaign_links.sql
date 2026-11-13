-- Stage 1: keep the commercial acquisition origin distinct from the Meta campaign.
-- This migration does not reattribute historical students or infer campaigns by timing.

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.student_acquisition
    WHERE declared_source = 'facebook'
  ) THEN
    RAISE EXCEPTION 'Historical Facebook origins must be audited before normalization.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.marketing_campaign_aliases
    WHERE alias = 'anuncio50'
      AND declared_source = 'anuncio50'
      AND meta_campaign_id = '120252326390770152'
  ) THEN
    RAISE EXCEPTION 'The canonical anuncio50 campaign is missing or has changed.';
  END IF;
END;
$guard$;

-- Existing integrations may send the legacy label; always store Instagram.
CREATE OR REPLACE FUNCTION private.canonical_acquisition_source(
  p_source text,
  p_detail text DEFAULT NULL::text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  candidate text;
  token text;
BEGIN
  IF p_source IS NULL THEN
    RETURN NULL;
  END IF;

  candidate := CASE
    WHEN lower(btrim(p_source)) = 'other' THEN coalesce(p_detail, '')
    ELSE p_source
  END;

  token := regexp_replace(
    translate(
      lower(btrim(candidate)),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[^a-z0-9]', '', 'g'
  );

  RETURN CASE
    WHEN token IN ('chatgpt', 'chatgptopenai', 'openaichatgpt') THEN 'chatgpt'
    WHEN token IN ('instagram', 'insta', 'facebook') THEN 'instagram'
    WHEN token = 'google' THEN 'google'
    WHEN token IN ('indicacao', 'indicacaodeamigo', 'indicacaodeamigooufamiliar') THEN 'referral'
    WHEN token = 'getninjas' THEN 'getninjas'
    WHEN token = 'anuncio80' THEN 'anúncio80'
    WHEN token IN ('anuncio50', 'meta11nov2650') THEN 'anuncio50'
    WHEN token IN ('naolembro', 'naomerecordo', 'unknown') THEN 'unknown'
    ELSE p_source
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION private.validate_acquisition_origin(
  p_source text,
  p_detail text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  canonical text := private.canonical_acquisition_source(p_source, p_detail);
BEGIN
  IF canonical IS NOT NULL
    AND canonical NOT IN (
      'instagram', 'chatgpt', 'google', 'referral',
      'getninjas', 'other', 'unknown', 'anúncio80', 'anuncio50'
    ) THEN
    RAISE EXCEPTION 'Origem inválida.' USING errcode = '22023';
  END IF;

  IF char_length(coalesce(p_detail, '')) > 120
    OR (
      canonical = 'other'
      AND nullif(btrim(coalesce(p_detail, '')), '') IS NULL
    ) THEN
    RAISE EXCEPTION 'Descreva a origem (até 120 caracteres).' USING errcode = '22023';
  END IF;
END;
$function$;

-- The business source and the confirmed Meta campaign are distinct fields.
-- An explicit campaign code creates a link; the student's source is Instagram.
CREATE OR REPLACE FUNCTION private.save_student_acquisition(
  p_student uuid,
  p_source text,
  p_detail text,
  p_via text,
  p_technical jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  old_source text;
  old_detail text;
  canonical text := private.canonical_acquisition_source(p_source, p_detail);
  canonical_detail text;
  requested_campaign text;
  existing_campaign text;
  linked_meta_campaign text;
BEGIN
  PERFORM private.validate_acquisition_origin(p_source, p_detail);

  IF p_via NOT IN ('student', 'teacher', 'reservation', 'trial') THEN
    RAISE EXCEPTION 'Responsável inválido.' USING errcode = '22023';
  END IF;

  SELECT campaign.alias
    INTO requested_campaign
  FROM private.marketing_campaign_aliases campaign
  WHERE campaign.declared_source = canonical
    AND campaign.meta_campaign_id IS NOT NULL;

  SELECT confirmed.campaign_alias
    INTO existing_campaign
  FROM private.marketing_campaign_confirmed_students confirmed
  WHERE confirmed.student_id = p_student;

  IF requested_campaign IS NOT NULL
    AND existing_campaign IS NOT NULL
    AND existing_campaign <> requested_campaign THEN
    RAISE EXCEPTION 'Aluno já vinculado a outra campanha Meta. Revise a atribuição.'
      USING errcode = '22023';
  END IF;

  SELECT confirmed.campaign_alias
    INTO linked_meta_campaign
  FROM private.marketing_campaign_confirmed_students confirmed
  JOIN private.marketing_campaign_aliases campaign
    ON campaign.alias = confirmed.campaign_alias
  WHERE confirmed.student_id = p_student
    AND campaign.meta_campaign_id IS NOT NULL;

  IF requested_campaign IS NOT NULL OR linked_meta_campaign IS NOT NULL THEN
    canonical := 'instagram';
  END IF;

  canonical_detail := CASE
    WHEN canonical = 'other' THEN nullif(btrim(p_detail), '')
    ELSE NULL
  END;

  SELECT acquisition.declared_source, acquisition.source_detail
    INTO old_source, old_detail
  FROM private.student_acquisition acquisition
  WHERE acquisition.student_id = p_student
  FOR UPDATE;

  INSERT INTO private.student_acquisition (
    student_id, declared_source, source_detail, recorded_via,
    technical_attribution, updated_by
  )
  VALUES (
    p_student, canonical, canonical_detail, p_via,
    coalesce(p_technical, '{}'::jsonb), auth.uid()
  )
  ON CONFLICT (student_id) DO UPDATE SET
    declared_source = excluded.declared_source,
    source_detail = excluded.source_detail,
    recorded_via = excluded.recorded_via,
    updated_by = excluded.updated_by,
    updated_at = now(),
    technical_attribution = CASE
      WHEN excluded.technical_attribution = '{}'::jsonb
        THEN private.student_acquisition.technical_attribution
      ELSE excluded.technical_attribution
    END;

  IF old_source IS DISTINCT FROM canonical
    OR old_detail IS DISTINCT FROM canonical_detail THEN
    INSERT INTO private.student_acquisition_history (
      student_id, previous_source, new_source, previous_detail,
      new_detail, changed_via, changed_by
    )
    VALUES (
      p_student, old_source, canonical, old_detail,
      canonical_detail, p_via, auth.uid()
    );
  END IF;

  IF requested_campaign IS NOT NULL THEN
    INSERT INTO private.marketing_campaign_confirmed_students (
      student_id, campaign_alias, evidence
    )
    VALUES (p_student, requested_campaign, 'declared_campaign_code')
    ON CONFLICT (student_id) DO NOTHING;

    SELECT confirmed.campaign_alias
      INTO existing_campaign
    FROM private.marketing_campaign_confirmed_students confirmed
    WHERE confirmed.student_id = p_student;

    IF existing_campaign IS DISTINCT FROM requested_campaign THEN
      RAISE EXCEPTION 'Conflito ao vincular a campanha Meta.'
        USING errcode = '22023';
    END IF;
  END IF;
END;
$function$;

-- A newly confirmed Meta link must set Instagram as the student source.
-- No automatic link is created based on tuition price or signup route.
CREATE OR REPLACE FUNCTION private.enforce_meta_campaign_instagram_origin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.campaign_alias IS NOT DISTINCT FROM OLD.campaign_alias THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.marketing_campaign_aliases campaign
    WHERE campaign.alias = NEW.campaign_alias
      AND campaign.meta_campaign_id IS NOT NULL
  ) THEN
    PERFORM private.save_student_acquisition(
      NEW.student_id, 'instagram', NULL, 'teacher', NULL
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_meta_campaign_instagram_origin
  ON private.marketing_campaign_confirmed_students;

CREATE TRIGGER enforce_meta_campaign_instagram_origin
AFTER INSERT OR UPDATE OF campaign_alias
ON private.marketing_campaign_confirmed_students
FOR EACH ROW EXECUTE FUNCTION private.enforce_meta_campaign_instagram_origin();

REVOKE ALL ON FUNCTION private.enforce_meta_campaign_instagram_origin()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_meta_campaign_instagram_origin()
  TO service_role;

-- Apply the same normalization to reservation and trial origin inputs.
DROP TRIGGER IF EXISTS canonicalize_promotion_reservation_origin
  ON private.promotion_reservations;
CREATE TRIGGER canonicalize_promotion_reservation_origin
BEFORE INSERT OR UPDATE OF declared_source, source_detail
ON private.promotion_reservations
FOR EACH ROW EXECUTE FUNCTION private.canonicalize_acquisition_row();

DROP TRIGGER IF EXISTS canonicalize_trial_lesson_origin
  ON private.trial_lesson_appointments;
CREATE TRIGGER canonicalize_trial_lesson_origin
BEFORE INSERT OR UPDATE OF declared_source, source_detail
ON private.trial_lesson_appointments
FOR EACH ROW EXECUTE FUNCTION private.canonicalize_acquisition_row();

-- Historical migrations are immutable; enforce the new rule with new constraints.
ALTER TABLE private.student_acquisition
  DROP CONSTRAINT student_origin_allowed;
ALTER TABLE private.student_acquisition
  ADD CONSTRAINT student_origin_allowed CHECK (
    declared_source IS NULL OR declared_source IN (
      'instagram', 'chatgpt', 'google', 'referral', 'getninjas',
      'other', 'unknown', 'anúncio80', 'anuncio50'
    )
  );

ALTER TABLE private.promotion_reservations
  DROP CONSTRAINT promotion_origin_allowed;
ALTER TABLE private.promotion_reservations
  ADD CONSTRAINT promotion_origin_allowed CHECK (
    declared_source IS NULL OR declared_source IN (
      'instagram', 'chatgpt', 'google', 'referral', 'getninjas',
      'other', 'unknown', 'anúncio80'
    )
  );

ALTER TABLE private.trial_lesson_appointments
  DROP CONSTRAINT trial_origin_allowed;
ALTER TABLE private.trial_lesson_appointments
  ADD CONSTRAINT trial_origin_allowed CHECK (
    declared_source IS NULL OR declared_source IN (
      'instagram', 'chatgpt', 'google', 'referral', 'getninjas',
      'other', 'unknown', 'anúncio80'
    )
  );

DO $verify$
BEGIN
  IF private.canonical_acquisition_source('Facebook', NULL) <> 'instagram'
    OR private.canonical_acquisition_source('other', 'Facebook') <> 'instagram'
    OR private.canonical_acquisition_source('Instagram', NULL) <> 'instagram'
    OR private.canonical_acquisition_source('META11NOV26/50', NULL) <> 'anuncio50'
    OR private.canonical_acquisition_source('Anuncio80', NULL) <> 'anúncio80'
    OR NOT EXISTS (
      SELECT 1 FROM private.marketing_campaign_aliases
      WHERE alias = 'anuncio50'
        AND meta_campaign_id = '120252326390770152'
    ) THEN
    RAISE EXCEPTION 'Verificação da normalização das campanhas falhou.';
  END IF;
END;
$verify$;

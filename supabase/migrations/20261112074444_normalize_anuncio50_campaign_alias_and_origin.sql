
-- Guard against merging a different campaign or displacing existing student links.
DO $guard$
BEGIN
  IF (SELECT count(*) FROM private.marketing_campaign_aliases
      WHERE alias = 'META11NOV26/50'
        AND declared_source = 'META11NOV26/50'
        AND meta_campaign_id = '120252326390770152'
        AND meta_ad_account_id = '804801286733503') <> 1 THEN
    RAISE EXCEPTION 'Campaign preconditions changed; aborting normalization.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.marketing_campaign_aliases
    WHERE alias = 'anuncio50' OR declared_source = 'anuncio50'
  ) THEN
    RAISE EXCEPTION 'The anuncio50 identity is already in use.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.marketing_campaign_confirmed_students
    WHERE campaign_alias = 'META11NOV26/50'
  ) THEN
    RAISE EXCEPTION 'Existing student links require an explicit migration.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.student_acquisition
    WHERE declared_source = 'META11NOV26/50'
  ) THEN
    RAISE EXCEPTION 'Existing student origin records require historical migration.';
  END IF;
END;
$guard$;

-- Keep the Meta identifier intact; normalize the operational campaign identity.
UPDATE private.marketing_campaign_aliases
SET alias = 'anuncio50',
    declared_source = 'anuncio50'
WHERE alias = 'META11NOV26/50'
  AND meta_campaign_id = '120252326390770152';

-- Remove the one-off exception for the old, nonstandard alias.
ALTER TABLE private.marketing_campaign_aliases
DROP CONSTRAINT marketing_campaign_alias_format;
ALTER TABLE private.marketing_campaign_aliases
ADD CONSTRAINT marketing_campaign_alias_format
CHECK (alias ~ '^[a-z][a-z0-9_]{1,49}$');

-- Make new attribution records canonical while still accepting the legacy input.
CREATE OR REPLACE FUNCTION private.canonical_acquisition_source(
  p_source text,
  p_detail text DEFAULT NULL::text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $fn$
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
    WHEN token IN ('instagram', 'insta') THEN 'instagram'
    WHEN token = 'facebook' THEN 'facebook'
    WHEN token = 'google' THEN 'google'
    WHEN token IN ('indicacao', 'indicacaodeamigo', 'indicacaodeamigooufamiliar') THEN 'referral'
    WHEN token = 'getninjas' THEN 'getninjas'
    WHEN token = 'anuncio80' THEN 'anúncio80'
    WHEN token IN ('anuncio50', 'meta11nov2650') THEN 'anuncio50'
    WHEN token IN ('naolembro', 'naomerecordo', 'unknown') THEN 'unknown'
    ELSE p_source
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.validate_acquisition_origin(
  p_source text,
  p_detail text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  canonical text := private.canonical_acquisition_source(p_source, p_detail);
BEGIN
  IF canonical IS NOT NULL
    AND canonical NOT IN (
      'instagram', 'chatgpt', 'google', 'referral',
      'facebook', 'getninjas', 'other', 'unknown',
      'anúncio80', 'anuncio50'
    ) THEN
    RAISE EXCEPTION 'Origem inválida.' USING errcode = '22023';
  END IF;

  IF char_length(coalesce(p_detail, '')) > 120
    OR (canonical = 'other' AND nullif(btrim(coalesce(p_detail, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Descreva a origem (até 120 caracteres).' USING errcode = '22023';
  END IF;
END;
$fn$;

ALTER TABLE private.student_acquisition
DROP CONSTRAINT student_origin_allowed;
ALTER TABLE private.student_acquisition
ADD CONSTRAINT student_origin_allowed
CHECK (
  declared_source = ANY (
    ARRAY[
      'instagram', 'chatgpt', 'google', 'referral',
      'facebook', 'getninjas', 'other', 'unknown',
      'anúncio80', 'anuncio50'
    ]::text[]
  )
);

DO $verify$
BEGIN
  IF (SELECT count(*) FROM private.marketing_campaign_aliases
      WHERE alias = 'anuncio50'
        AND declared_source = 'anuncio50'
        AND meta_campaign_id = '120252326390770152') <> 1
    OR private.canonical_acquisition_source('META11NOV26/50', NULL) <> 'anuncio50'
    OR private.canonical_acquisition_source('anuncio50', NULL) <> 'anuncio50'
  THEN
    RAISE EXCEPTION 'Campaign normalization verification failed.';
  END IF;
END;
$verify$;

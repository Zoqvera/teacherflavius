
ALTER TABLE private.student_acquisition
  DROP CONSTRAINT student_origin_allowed;

ALTER TABLE private.student_acquisition
  ADD CONSTRAINT student_origin_allowed
  CHECK (
    declared_source IS NULL
    OR declared_source = ANY (
      ARRAY[
        'instagram', 'chatgpt', 'google', 'referral',
        'facebook', 'getninjas', 'other', 'unknown',
        'anúncio80', 'anuncio50'
      ]
    )
  );

CREATE OR REPLACE FUNCTION private.canonical_acquisition_source(
  p_source text,
  p_detail text DEFAULT NULL::text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
declare
  candidate text;
  token text;
begin
  if p_source is null then return null; end if;

  candidate := case when lower(btrim(p_source)) = 'other'
    then coalesce(p_detail, '') else p_source end;
  token := regexp_replace(
    translate(
      lower(btrim(candidate)),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[^a-z0-9]', '', 'g'
  );

  return case
    when token in ('chatgpt', 'chatgptopenai', 'openaichatgpt') then 'chatgpt'
    when token in ('instagram', 'insta') then 'instagram'
    when token in ('facebook') then 'facebook'
    when token in ('google') then 'google'
    when token in ('indicacao', 'indicacaodeamigo', 'indicacaodeamigooufamiliar') then 'referral'
    when token in ('getninjas') then 'getninjas'
    when token = 'anuncio80' then 'anúncio80'
    when token = 'anuncio50' then 'anuncio50'
    when token in ('naolembro', 'naomerecordo', 'unknown') then 'unknown'
    else p_source
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_acquisition_origin(
  p_source text, p_detail text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  canonical text := private.canonical_acquisition_source(p_source, p_detail);
begin
  if canonical is not null
    and canonical not in (
      'instagram', 'chatgpt', 'google', 'referral',
      'facebook', 'getninjas', 'other', 'unknown',
      'anúncio80', 'anuncio50'
    ) then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_detail, '')) > 120
    or (canonical = 'other' and nullif(btrim(coalesce(p_detail, '')), '') is null) then
    raise exception 'Descreva a origem (até 120 caracteres).' using errcode = '22023';
  end if;
end;
$function$;

CREATE TABLE private.marketing_campaign_aliases (
  alias text PRIMARY KEY,
  meta_campaign_id text NOT NULL UNIQUE,
  meta_ad_account_id text NOT NULL,
  started_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaign_alias_format CHECK (alias ~ '^[a-z][a-z0-9_]{1,49}$')
);

ALTER TABLE private.marketing_campaign_aliases ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON private.marketing_campaign_aliases TO service_role;

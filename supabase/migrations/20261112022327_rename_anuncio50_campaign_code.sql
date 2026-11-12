alter table private.marketing_campaign_aliases
  drop constraint marketing_campaign_alias_format,
  add constraint marketing_campaign_alias_format check (
    alias ~ '^[a-z][a-z0-9_]{1,49}$' or alias = 'META11NOV26/50'
  );

alter table private.student_acquisition drop constraint student_origin_allowed;

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
    when token in ('anuncio50', 'meta11nov2650') then 'META11NOV26/50'
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
      'anúncio80', 'META11NOV26/50'
    ) then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_detail, '')) > 120
    or (canonical = 'other' and nullif(btrim(coalesce(p_detail, '')), '') is null) then
    raise exception 'Descreva a origem (até 120 caracteres).' using errcode = '22023';
  end if;
end;
$function$;

with renamed_campaign as (
  update private.marketing_campaign_aliases
  set alias = 'META11NOV26/50',
      declared_source = 'META11NOV26/50',
      display_name = 'META11NOV26/50'
  where alias = 'anuncio50'
    and meta_campaign_id = '120252326390770152'
  returning alias
)
update private.marketing_campaign_confirmed_students as confirmed
set campaign_alias = renamed_campaign.alias
from renamed_campaign
where confirmed.campaign_alias = 'anuncio50';

update private.student_acquisition
set declared_source = 'META11NOV26/50'
where declared_source = 'anuncio50';

alter table private.student_acquisition
  add constraint student_origin_allowed check (
    declared_source in (
      'instagram', 'chatgpt', 'google', 'referral',
      'facebook', 'getninjas', 'other', 'unknown',
      'anúncio80', 'META11NOV26/50'
    )
  );

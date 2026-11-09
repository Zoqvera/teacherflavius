-- New acquisition origin for the R$ 80 Instagram campaign.
-- Preserve existing sources and all pre-existing student attribution.

alter table private.student_acquisition
  drop constraint if exists student_origin_allowed;
alter table private.student_acquisition
  add constraint student_origin_allowed check (
    declared_source is null or
    declared_source in (
      'instagram', 'chatgpt', 'google', 'referral', 'facebook',
      'getninjas', 'other', 'unknown', 'anúncio80'
    )
  );

alter table private.promotion_reservations
  drop constraint if exists promotion_origin_allowed;
alter table private.promotion_reservations
  add constraint promotion_origin_allowed check (
    declared_source is null or
    declared_source in (
      'instagram', 'chatgpt', 'google', 'referral', 'facebook',
      'getninjas', 'other', 'unknown', 'anúncio80'
    )
  );

alter table private.trial_lesson_appointments
  drop constraint if exists trial_origin_allowed;
alter table private.trial_lesson_appointments
  add constraint trial_origin_allowed check (
    declared_source is null or
    declared_source in (
      'instagram', 'chatgpt', 'google', 'referral', 'facebook',
      'getninjas', 'other', 'unknown', 'anúncio80'
    )
  );

create or replace function private.canonical_acquisition_source(
  p_source text, p_detail text default null
)
returns text language plpgsql immutable set search_path = '' as $$
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
    when token in ('naolembro', 'naomerecordo', 'unknown') then 'unknown'
    else p_source
  end;
end;
$$;

create or replace function private.validate_acquisition_origin(
  p_source text, p_detail text
)
returns void language plpgsql set search_path = '' as $$
declare
  canonical text := private.canonical_acquisition_source(p_source, p_detail);
begin
  if canonical is not null
    and canonical not in (
      'instagram', 'chatgpt', 'google', 'referral',
      'facebook', 'getninjas', 'other', 'unknown', 'anúncio80'
    ) then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_detail, '')) > 120
    or (canonical = 'other' and nullif(btrim(coalesce(p_detail, '')), '') is null) then
    raise exception 'Descreva a origem (até 120 caracteres).' using errcode = '22023';
  end if;
end;
$$;

-- Assertions verify the canonical value, existing sources, and validation.
do $
begin
  if private.canonical_acquisition_source('anúncio80', null) <> 'anúncio80'
    or private.canonical_acquisition_source('Anuncio80', null) <> 'anúncio80'
    or private.canonical_acquisition_source('other', 'Anúncio 80') <> 'anúncio80'
    or private.canonical_acquisition_source('instagram', null) <> 'instagram'
    or private.canonical_acquisition_source('other', 'TikTok') <> 'other'
  then
    raise exception 'Falha na validação da origem anúncio80.';
  end if;
  perform private.validate_acquisition_origin('anúncio80', null);
end;
$$;

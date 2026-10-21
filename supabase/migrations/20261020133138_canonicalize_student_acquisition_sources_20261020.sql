-- Canonicalizes declared acquisition sources at the database boundary.
-- Keep genuinely distinct "other" responses (e.g. TikTok and WhatsApp).
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
    when token in ('naolembro', 'naomerecordo', 'unknown') then 'unknown'
    else p_source
  end;
end;
$$;

-- All RPC writers validate canonical values, including free-text answers.
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
      'facebook', 'getninjas', 'other', 'unknown'
    ) then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_detail, '')) > 120
    or (canonical = 'other' and nullif(btrim(coalesce(p_detail, '')), '') is null) then
    raise exception 'Descreva a origem (até 120 caracteres).' using errcode = '22023';
  end if;
end;
$$;

-- Preserve the original reporting channel and technical attribution;
-- write canonical values to both current state and history.
create or replace function private.save_student_acquisition(
  p_student uuid, p_source text, p_detail text, p_via text,
  p_technical jsonb default null
)
returns void language plpgsql set search_path = '' as $$
declare
  old_source text;
  old_detail text;
  canonical text := private.canonical_acquisition_source(p_source, p_detail);
  canonical_detail text;
begin
  perform private.validate_acquisition_origin(p_source, p_detail);
  if p_via not in ('student', 'teacher', 'reservation', 'trial') then
    raise exception 'Responsável inválido.' using errcode = '22023';
  end if;
  canonical_detail := case when canonical = 'other'
    then nullif(btrim(p_detail), '') else null end;

  select declared_source, source_detail into old_source, old_detail
  from private.student_acquisition where student_id = p_student for update;

  insert into private.student_acquisition (
    student_id, declared_source, source_detail, recorded_via,
    technical_attribution, updated_by
  )
  values (
    p_student, canonical, canonical_detail, p_via,
    coalesce(p_technical, '{}'::jsonb), auth.uid()
  )
  on conflict (student_id) do update set
    declared_source = excluded.declared_source,
    source_detail = excluded.source_detail,
    recorded_via = excluded.recorded_via,
    updated_by = excluded.updated_by,
    updated_at = now(),
    technical_attribution = case
      when excluded.technical_attribution = '{}'::jsonb
        then private.student_acquisition.technical_attribution
      else excluded.technical_attribution end;

  if old_source is distinct from canonical
    or old_detail is distinct from canonical_detail then
    insert into private.student_acquisition_history (
      student_id, previous_source, new_source, previous_detail,
      new_detail, changed_via, changed_by
    )
    values (
      p_student, old_source, canonical, old_detail,
      canonical_detail, p_via, auth.uid()
    );
  end if;
end;
$$;

-- Defensive normalization for any direct insert/update, including leads.
create or replace function private.canonicalize_acquisition_row()
returns trigger language plpgsql set search_path = '' as $$
declare
  canonical text;
begin
  canonical := private.canonical_acquisition_source(
    new.declared_source, new.source_detail
  );
  new.source_detail := case when canonical = 'other'
    then nullif(btrim(new.source_detail), '') else null end;
  new.declared_source := canonical;
  return new;
end;
$$;

create trigger canonicalize_student_acquisition_row
before insert or update of declared_source, source_detail
on private.student_acquisition
for each row execute function private.canonicalize_acquisition_row();

create trigger canonicalize_reservation_acquisition_row
before insert or update of declared_source, source_detail
on private.promotion_reservations
for each row execute function private.canonicalize_acquisition_row();

create trigger canonicalize_trial_acquisition_row
before insert or update of declared_source, source_detail
on private.trial_lesson_appointments
for each row execute function private.canonicalize_acquisition_row();

-- Fix existing student entries and retain their raw answer in audit history.
with candidates as (
  select a.student_id, a.declared_source as previous_source,
    a.source_detail as previous_detail,
    private.canonical_acquisition_source(
      a.declared_source, a.source_detail
    ) as canonical
  from private.student_acquisition a
  where a.declared_source = 'other'
    and private.canonical_acquisition_source(
      a.declared_source, a.source_detail
    ) <> 'other'
  for update
), corrected as (
  update private.student_acquisition a
  set declared_source = c.canonical, source_detail = null, updated_at = now()
  from candidates c where a.student_id = c.student_id
  returning a.student_id
)
insert into private.student_acquisition_history (
  student_id, previous_source, new_source, previous_detail,
  new_detail, changed_via, changed_by
)
select c.student_id, c.previous_source, c.canonical, c.previous_detail,
  null, 'normalization', null
from candidates c join corrected x using (student_id);

-- Apply the same fix to previously captured reservations/trials.
update private.promotion_reservations
set declared_source = private.canonical_acquisition_source(
      declared_source, source_detail
    ),
    source_detail = null,
    updated_at = now()
where declared_source = 'other'
  and private.canonical_acquisition_source(declared_source, source_detail) <> 'other';

update private.trial_lesson_appointments
set declared_source = private.canonical_acquisition_source(
      declared_source, source_detail
    ),
    source_detail = null,
    updated_at = now()
where declared_source = 'other'
  and private.canonical_acquisition_source(declared_source, source_detail) <> 'other';

-- A failed assertion rolls back the migration, including data corrections.
do $$
begin
  if private.canonical_acquisition_source('other', 'Chat gpt') <> 'chatgpt'
    or private.canonical_acquisition_source('other', 'CHAT-GPT') <> 'chatgpt'
    or private.canonical_acquisition_source('ChatGPT', null) <> 'chatgpt'
    or private.canonical_acquisition_source('other', 'Indicação') <> 'referral'
    or private.canonical_acquisition_source('other', 'Get Ninjas') <> 'getninjas'
    or private.canonical_acquisition_source('other', 'TikTok') <> 'other'
    or private.canonical_acquisition_source('other', 'WhatsApp') <> 'other'
    or private.canonical_acquisition_source('other', 'Cartaz no bairro') <> 'other'
  then
    raise exception 'Falha nos testes de normalização de origem.';
  end if;
end;
$$;

revoke all on function private.canonical_acquisition_source(text,text)
  from public, anon, authenticated;
revoke all on function private.canonicalize_acquisition_row()
  from public, anon, authenticated;

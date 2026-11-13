-- Only reconcile confirmed campaign links with compatible declared sources.
-- Historical conflicting student declarations and tags are retained.

ALTER TABLE public.student_origin_attributions
  DROP CONSTRAINT student_origin_attributions_recorded_via_check;
ALTER TABLE public.student_origin_attributions
  ADD CONSTRAINT student_origin_attributions_recorded_via_check
  CHECK (recorded_via IN ('student_tag', 'marketing_lead', 'meta_campaign'));

CREATE OR REPLACE FUNCTION public.sync_student_origin_attribution(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_source text;
  v_campaign text;
  v_recorded_via text;
  v_source_record_id uuid;
  v_source_label text;
  v_current public.student_origin_attributions%rowtype;
begin
  if p_student_id is null then
    return;
  end if;

  select st.id, st.tag_name
    into v_source_record_id, v_source_label
  from public.student_tags st
  where st.user_id = p_student_id
    and lower(btrim(st.tag_name)) like 'origem:%'
  order by
    case
      when lower(st.tag_name) like '%anúncio promocional%' then 0
      when lower(st.tag_name) like '%anuncio promocional%' then 0
      when lower(st.tag_name) like '%anuncio50%' or lower(st.tag_name) like '%anuncio80%' then 0
      else 1
    end,
    st.created_at desc,
    st.id
  limit 1;

  if v_source_record_id is not null then
    v_recorded_via := 'student_tag';
    v_source_label := btrim(v_source_label);

    if lower(v_source_label) like '%instagram%'
       or lower(v_source_label) like '%anúncio%'
       or lower(v_source_label) like '%anuncio%'
       or lower(v_source_label) like '%anuncio50%'
       or lower(v_source_label) like '%anuncio80%' then
      v_source := 'Instagram';
    else
      v_source := btrim(regexp_replace(v_source_label, '^Origem:\s*', '', 'i'));
      if lower(v_source) = 'chatgpt' then
        v_source := 'ChatGPT';
      elsif lower(v_source) = 'indicação' or lower(v_source) = 'indicacao' then
        v_source := 'Indicação';
      end if;
    end if;

    if lower(v_source_label) like '%anúncio promocional%'
       or lower(v_source_label) like '%anuncio promocional%'
       or lower(v_source_label) like '%anuncio50%'
       or lower(v_source_label) like '%anuncio80%' then
      v_campaign := btrim(regexp_replace(v_source_label, '^Origem:\s*', '', 'i'));
    else
      v_campaign := null;
    end if;
  else
    select ml.id, ml.source, ml.campaign
      into v_source_record_id, v_source, v_campaign
    from public.marketing_commercial_leads ml
    where ml.student_id = p_student_id
    order by ml.enrolled_at desc nulls last,
             ml.lead_event_at desc nulls last,
             ml.created_at desc,
             ml.id
    limit 1;

    if v_source_record_id is not null then
      v_recorded_via := 'marketing_lead';
      v_source_label := coalesce(nullif(btrim(v_source), ''), 'Origem não especificada');
      v_source := coalesce(nullif(btrim(v_source), ''), 'Origem não especificada');

      if lower(v_source) = 'chatgpt' then
        v_source := 'ChatGPT';
      elsif lower(v_source) = 'google' or lower(v_source) = 'accounts.google.com' then
        v_source := 'Google';
      elsif lower(v_source) = 'direct' then
        v_source := 'Direto';
      else
        v_source := initcap(v_source);
      end if;

      if lower(btrim(coalesce(v_campaign, ''))) = 'not_set' then
        v_campaign := null;
      else
        v_campaign := nullif(btrim(v_campaign), '');
      end if;
    end if;

    -- Accept only a linked Meta campaign and an already compatible self-declared source.
    -- Tag and lead evidence keep precedence; do not overwrite conflicts.
    if v_source_record_id is null then
      select link.student_id, link.campaign_alias
        into v_source_record_id, v_campaign
      from private.marketing_campaign_confirmed_students link
      join private.marketing_campaign_aliases campaign
        on campaign.alias = link.campaign_alias
      join private.student_acquisition acquisition
        on acquisition.student_id = link.student_id
      where link.student_id = p_student_id
        and campaign.meta_campaign_id is not null
        and acquisition.declared_source = 'instagram'
      limit 1;

      if v_source_record_id is not null then
        v_source := 'Instagram';
        v_recorded_via := 'meta_campaign';
        v_source_label := 'Vínculo Meta registrado: ' || v_campaign;
      end if;
    end if;
  end if;

  select *
    into v_current
  from public.student_origin_attributions
  where student_id = p_student_id
    and is_current
  limit 1;

  if v_source_record_id is null then
    if found then
      update public.student_origin_attributions
      set is_current = false
      where id = v_current.id;
    end if;
    return;
  end if;

  if found
     and v_current.source = v_source
     and v_current.campaign is not distinct from v_campaign
     and v_current.recorded_via = v_recorded_via
     and v_current.source_record_id = v_source_record_id
     and v_current.source_label = v_source_label then
    return;
  end if;

  update public.student_origin_attributions
  set is_current = false
  where student_id = p_student_id
    and is_current;

  insert into public.student_origin_attributions (
    student_id, source, campaign, recorded_via, source_record_id, source_label
  ) values (
    p_student_id, v_source, v_campaign, v_recorded_via, v_source_record_id, v_source_label
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.sync_origin_after_meta_campaign_link()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_student_origin_attribution(OLD.student_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_student_origin_attribution(NEW.student_id);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.sync_origin_after_meta_campaign_link()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_origin_after_meta_campaign_link() TO service_role;

DROP TRIGGER IF EXISTS sync_origin_after_meta_campaign_link
  ON private.marketing_campaign_confirmed_students;
CREATE TRIGGER sync_origin_after_meta_campaign_link
AFTER INSERT OR UPDATE OF campaign_alias OR DELETE
ON private.marketing_campaign_confirmed_students
FOR EACH ROW EXECUTE FUNCTION private.sync_origin_after_meta_campaign_link();

CREATE OR REPLACE FUNCTION private.sync_origin_after_acquisition_change()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  PERFORM public.sync_student_origin_attribution(NEW.student_id);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.sync_origin_after_acquisition_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_origin_after_acquisition_change() TO service_role;

DROP TRIGGER IF EXISTS sync_origin_after_acquisition_change ON private.student_acquisition;
CREATE TRIGGER sync_origin_after_acquisition_change
AFTER INSERT OR UPDATE OF declared_source
ON private.student_acquisition
FOR EACH ROW EXECUTE FUNCTION private.sync_origin_after_acquisition_change();

CREATE OR REPLACE VIEW private.marketing_campaign_origin_reconciliation
WITH (security_invoker = true) AS
SELECT confirmed.student_id, profile.name AS student_name,
       confirmed.campaign_alias, campaign.meta_campaign_id,
       confirmed.evidence AS campaign_evidence,
       acquisition.declared_source,
       acquisition.recorded_via AS declared_recorded_via,
       canonical.source AS canonical_source,
       canonical.campaign AS canonical_campaign,
       canonical.recorded_via AS canonical_recorded_via,
       CASE
         WHEN canonical.student_id IS NOT NULL
           AND lower(btrim(canonical.source)) <> 'instagram'
           THEN 'canonical_conflict'
         WHEN acquisition.declared_source IS NOT NULL
           AND acquisition.declared_source NOT IN ('instagram','anúncio80','anuncio50')
           THEN 'declared_conflict'
         WHEN acquisition.student_id IS NULL OR acquisition.declared_source IS NULL
           THEN 'missing_declared'
         WHEN canonical.student_id IS NULL THEN 'missing_canonical'
         ELSE 'aligned'
       END AS reconciliation_status
FROM private.marketing_campaign_confirmed_students confirmed
JOIN private.marketing_campaign_aliases campaign
 ON campaign.alias = confirmed.campaign_alias AND campaign.meta_campaign_id IS NOT NULL
JOIN public.profiles profile ON profile.id = confirmed.student_id
LEFT JOIN private.student_acquisition acquisition
 ON acquisition.student_id = confirmed.student_id
LEFT JOIN public.student_origin_attributions canonical
 ON canonical.student_id = confirmed.student_id AND canonical.is_current;
REVOKE ALL ON private.marketing_campaign_origin_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.marketing_campaign_origin_reconciliation TO service_role;

-- The backfill only creates a new canonical row if neither a tag nor a lead exists.
DO $backfill$
DECLARE student record;
BEGIN
  FOR student IN
    SELECT confirmed.student_id
    FROM private.marketing_campaign_confirmed_students confirmed
    JOIN private.marketing_campaign_aliases campaign
      ON campaign.alias = confirmed.campaign_alias
     AND campaign.meta_campaign_id IS NOT NULL
    JOIN private.student_acquisition acquisition
      ON acquisition.student_id = confirmed.student_id
     AND acquisition.declared_source = 'instagram'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_origin_attributions canonical
      WHERE canonical.student_id = confirmed.student_id AND canonical.is_current
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.student_tags tag
      WHERE tag.user_id = confirmed.student_id
        AND lower(btrim(tag.tag_name)) LIKE 'origem:%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_commercial_leads lead
      WHERE lead.student_id = confirmed.student_id
    )
    ORDER BY confirmed.student_id
  LOOP
    PERFORM public.sync_student_origin_attribution(student.student_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.student_origin_attributions canonical
      WHERE canonical.student_id = student.student_id AND canonical.is_current
        AND canonical.source = 'Instagram' AND canonical.recorded_via = 'meta_campaign'
    ) THEN RAISE EXCEPTION 'Backfill failed for student %',student.student_id;
    END IF;
  END LOOP;
END;
$backfill$;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.marketing_campaign_origin_reconciliation
    WHERE reconciliation_status = 'missing_canonical' AND declared_source = 'instagram'
  ) THEN
    RAISE EXCEPTION 'Eligible campaign-linked students remain without canonical origin';
  END IF;
END;
$verify$;
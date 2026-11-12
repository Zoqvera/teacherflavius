create or replace function public.sync_student_origin_attribution(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
$function$;

create or replace function public.sync_student_origin_after_tag_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op <> 'INSERT' then
    perform public.sync_student_origin_attribution(old.user_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.sync_student_origin_attribution(new.user_id);
    return new;
  end if;
  return old;
end;
$function$;

create or replace function public.sync_student_origin_after_lead_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if tg_op <> 'INSERT' and old.student_id is not null then
    perform public.sync_student_origin_attribution(old.student_id);
  end if;
  if tg_op <> 'DELETE' and new.student_id is not null then
    perform public.sync_student_origin_attribution(new.student_id);
    return new;
  end if;
  return old;
end;
$function$;

do $normalize$
declare
  v_student_id uuid;
begin
  for v_student_id in
    select student_id
    from public.student_origin_attributions
    where is_current
      and recorded_via = 'marketing_lead'
      and lower(btrim(coalesce(campaign, ''))) = 'not_set'
  loop
    perform public.sync_student_origin_attribution(v_student_id);
  end loop;
end;
$normalize$;

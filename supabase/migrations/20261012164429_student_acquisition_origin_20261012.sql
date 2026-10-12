-- Origem declarada (primeira descoberta) independente dos dados de tráfego técnico.
create table if not exists private.student_acquisition (
 student_id uuid primary key references public.profiles(id) on delete cascade,
 declared_source text,
 source_detail text,
 recorded_via text not null default 'student',
 technical_attribution jsonb not null default '{}'::jsonb,
 updated_by uuid,
 updated_at timestamptz not null default now(),
 constraint student_origin_allowed check (declared_source is null or declared_source in ('instagram','chatgpt','google','referral','facebook','other','unknown')),
 constraint student_origin_detail check (source_detail is null or char_length(source_detail) <= 120),
 constraint student_origin_detail_required check (declared_source <> 'other' or nullif(btrim(source_detail),'') is not null),
 constraint student_origin_via_allowed check (recorded_via in ('student','teacher','reservation','trial'))
);
create table if not exists private.student_acquisition_history (
 id bigint generated always as identity primary key,
 student_id uuid not null references public.profiles(id) on delete cascade,
 previous_source text,
 new_source text,
 previous_detail text,
 new_detail text,
 changed_via text not null,
 changed_by uuid,
 changed_at timestamptz not null default now()
);
alter table private.student_acquisition enable row level security;
alter table private.student_acquisition_history enable row level security;
revoke all on private.student_acquisition, private.student_acquisition_history from public, anon, authenticated;
revoke all on sequence private.student_acquisition_history_id_seq from public, anon, authenticated;
create index if not exists student_acquisition_history_student_idx on private.student_acquisition_history(student_id, changed_at desc);

alter table private.promotion_reservations
 add column if not exists declared_source text,
 add column if not exists source_detail text;
alter table private.trial_lesson_appointments
 add column if not exists declared_source text,
 add column if not exists source_detail text;
alter table private.promotion_reservations drop constraint if exists promotion_origin_allowed;
alter table private.promotion_reservations add constraint promotion_origin_allowed check (
 declared_source is null or declared_source in ('instagram','chatgpt','google','referral','facebook','other','unknown'));
alter table private.trial_lesson_appointments drop constraint if exists trial_origin_allowed;
alter table private.trial_lesson_appointments add constraint trial_origin_allowed check (
 declared_source is null or declared_source in ('instagram','chatgpt','google','referral','facebook','other','unknown'));
alter table private.promotion_reservations drop constraint if exists promotion_origin_detail_valid;
alter table private.promotion_reservations add constraint promotion_origin_detail_valid check (
 char_length(coalesce(source_detail,'')) <= 120 and (declared_source <> 'other' or nullif(btrim(source_detail),'') is not null));
alter table private.trial_lesson_appointments drop constraint if exists trial_origin_detail_valid;
alter table private.trial_lesson_appointments add constraint trial_origin_detail_valid check (
 char_length(coalesce(source_detail,'')) <= 120 and (declared_source <> 'other' or nullif(btrim(source_detail),'') is not null));

create or replace function private.validate_acquisition_origin(p_source text, p_detail text)
returns void language plpgsql set search_path = '' as $$
begin
 if p_source is not null and p_source not in ('instagram','chatgpt','google','referral','facebook','other','unknown') then
   raise exception 'Origem inválida.' using errcode='22023';
 end if;
 if char_length(coalesce(p_detail,'')) > 120
  or (p_source='other' and nullif(btrim(coalesce(p_detail,'')),'') is null) then
   raise exception 'Descreva a origem (até 120 caracteres).' using errcode='22023';
 end if;
end; $$;

create or replace function private.save_student_acquisition(
 p_student uuid, p_source text, p_detail text, p_via text, p_technical jsonb default null)
returns void language plpgsql set search_path = '' as $$
declare old_source text; old_detail text;
begin
 perform private.validate_acquisition_origin(p_source,p_detail);
 if p_via not in ('student','teacher','reservation','trial') then
  raise exception 'Responsável inválido.' using errcode='22023';
 end if;
 select declared_source, source_detail into old_source,old_detail
 from private.student_acquisition where student_id=p_student for update;
 insert into private.student_acquisition(student_id,declared_source,source_detail,recorded_via,technical_attribution,updated_by)
 values(p_student,p_source,case when p_source='other' then nullif(btrim(p_detail),'') else null end,p_via,
   coalesce(p_technical,'{}'::jsonb),auth.uid())
 on conflict(student_id) do update set
 declared_source=excluded.declared_source,source_detail=excluded.source_detail,
 recorded_via=excluded.recorded_via,updated_by=excluded.updated_by,updated_at=now(),
 technical_attribution=case when excluded.technical_attribution='{}'::jsonb
  then private.student_acquisition.technical_attribution else excluded.technical_attribution end;
 if old_source is distinct from p_source or old_detail is distinct from
    (case when p_source='other' then nullif(btrim(p_detail),'') else null end) then
  insert into private.student_acquisition_history
  (student_id,previous_source,new_source,previous_detail,new_detail,changed_via,changed_by)
  values(p_student,old_source,p_source,old_detail,
   case when p_source='other' then nullif(btrim(p_detail),'') else null end,p_via,auth.uid());
 end if;
end; $$;

create or replace function public.get_my_student_acquisition()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Faça login.' using errcode='42501'; end if;
 return coalesce((select jsonb_build_object('source',declared_source,'detail',source_detail)
 from private.student_acquisition where student_id=auth.uid()), '{}'::jsonb);
end; $$;

create or replace function public.set_my_student_acquisition(
 target_source text, target_detail text default null, target_technical jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype; safe_technical jsonb;
begin
 if auth.uid() is null then raise exception 'Faça login.' using errcode='42501'; end if;
 select * into p from public.profiles where id=auth.uid() for update;
 if not found or p.archived is true or p.profile_completed is true then
  raise exception 'Origem disponível apenas durante a conclusão do cadastro.' using errcode='42501';
 end if;
 if target_source is null then raise exception 'Selecione como conheceu as aulas.' using errcode='22023'; end if;
 if target_technical is not null and jsonb_typeof(target_technical)<>'object' then
  raise exception 'Dados técnicos inválidos.' using errcode='22023';
 end if;
 safe_technical := jsonb_strip_nulls(jsonb_build_object(
 'utm_source',left(coalesce(target_technical->>'utm_source',''),120),
 'utm_medium',left(coalesce(target_technical->>'utm_medium',''),120),
 'utm_campaign',left(coalesce(target_technical->>'utm_campaign',''),120),
 'referrer_host',left(coalesce(target_technical->>'referrer_host',''),120)));
 perform private.save_student_acquisition(p.id,target_source,target_detail,'student',safe_technical);
end; $$;

create or replace function public.get_teacher_student_acquisitions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.is_teacher_admin() then raise exception 'Acesso do professor obrigatório.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'student_id',a.student_id,'source',a.declared_source,'detail',a.source_detail,
  'recorded_via',a.recorded_via,'updated_at',a.updated_at))
 from private.student_acquisition a),'[]'::jsonb);
end; $$;

create or replace function public.set_teacher_student_acquisition(
 target_student_id uuid,target_source text,target_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_teacher_admin() then raise exception 'Acesso do professor obrigatório.' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=target_student_id) then
  raise exception 'Perfil do aluno não encontrado.' using errcode='P0002';
 end if;
 perform private.save_student_acquisition(target_student_id,target_source,target_detail,'teacher',null);
end; $$;

create or replace function private.inherit_student_acquisition(p_student uuid)
returns void language plpgsql set search_path = '' as $$
declare phone text; matched_source text; matched_detail text; via text;
begin
 if exists(select 1 from private.student_acquisition where student_id=p_student and declared_source is not null) then return; end if;
 select private.normalize_trial_phone(p.whatsapp) into phone
 from public.profiles p where p.id=p_student and p.enrolled is true and coalesce(p.archived,false)=false;
 if phone is null then return; end if;
 if (select count(*) from public.profiles p where p.enrolled is true and coalesce(p.archived,false)=false
  and private.normalize_trial_phone(p.whatsapp)=phone) <> 1 then return; end if;
 select x.declared_source,x.source_detail,x.via into matched_source,matched_detail,via
 from (
  select r.declared_source,r.source_detail,'reservation'::text via, r.created_at sort_time,0 priority
  from private.promotion_reservations r
  where r.normalized_phone=phone and r.declared_source is not null
  union all
  select t.declared_source,t.source_detail,'trial'::text via,t.created_at sort_time,1 priority
  from private.trial_lesson_appointments t
  where private.normalize_trial_phone(t.whatsapp)=phone and t.declared_source is not null
 ) x order by x.priority,x.sort_time desc limit 1;
 if matched_source is null then return; end if;
 perform private.save_student_acquisition(p_student,matched_source,matched_detail,via,null);
end; $$;

create or replace function private.reconcile_student_acquisition_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.enrolled is true and coalesce(new.archived,false)=false then
   perform private.inherit_student_acquisition(new.id);
 end if;
 return new;
end; $$;
create trigger reconcile_student_acquisition_on_insert
after insert on public.profiles for each row
execute function private.reconcile_student_acquisition_trigger();
create trigger reconcile_student_acquisition_on_update
after update of enrolled, archived, whatsapp on public.profiles for each row
when (old.enrolled is distinct from new.enrolled or old.archived is distinct from new.archived
 or old.whatsapp is distinct from new.whatsapp)
execute function private.reconcile_student_acquisition_trigger();

create or replace function public.get_teacher_lead_acquisitions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.is_teacher_admin() then raise exception 'Acesso do professor obrigatório.' using errcode='42501'; end if;
 return (select jsonb_build_object(
 'reservations', coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',declared_source,'detail',source_detail))
  from private.promotion_reservations),'[]'::jsonb),
 'trials',coalesce((select jsonb_agg(jsonb_build_object('id',id,'source',declared_source,'detail',source_detail))
  from private.trial_lesson_appointments),'[]'::jsonb)));
end; $$;

create or replace function public.set_teacher_lead_acquisition(
 target_kind text,target_id uuid,target_source text,target_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare linked uuid;
begin
 if not public.is_teacher_admin() then raise exception 'Acesso do professor obrigatório.' using errcode='42501'; end if;
 perform private.validate_acquisition_origin(target_source,target_detail);
 if target_kind='reservation' then
  update private.promotion_reservations
  set declared_source=target_source,
   source_detail=case when target_source='other' then nullif(btrim(target_detail),'') else null end,
   updated_at=now()
  where id=target_id returning matched_student_id into linked;
 elsif target_kind='trial' then
  update private.trial_lesson_appointments
  set declared_source=target_source,
   source_detail=case when target_source='other' then nullif(btrim(target_detail),'') else null end,
   updated_at=now()
  where id=target_id returning matched_student_id into linked;
 else
  raise exception 'Tipo de interessado inválido.' using errcode='22023';
 end if;
 if not found then raise exception 'Interessado não encontrado.' using errcode='P0002'; end if;
 if linked is not null and target_source is not null
  and not exists(select 1 from private.student_acquisition where student_id=linked and declared_source is not null)
 then perform private.inherit_student_acquisition(linked);
 end if;
end; $$;

create or replace function public.get_teacher_declared_acquisition_report(period_days integer default 30)
returns jsonb language sql stable security definer set search_path = '' as $$
with cohort as (
 select p.id,coalesce(a.declared_source,'not_informed') as source
 from public.profiles p left join private.student_acquisition a on a.student_id=p.id
 where p.enrolled is true and coalesce(p.archived,false)=false
  and coalesce(p.enrolled_at,p.created_at)>=now() - (least(greatest(coalesce(period_days,30),1),3650) * interval '1 day')
), payments as (
 select t.student_id, sum(coalesce(t.amount_paid,0)) as revenue
 from public.monthly_tuition t where t.student_id in (select id from cohort)
 group by t.student_id
), by_source as (
 select c.source,count(*)::int enrollments,coalesce(sum(p.revenue),0) revenue
 from cohort c left join payments p on p.student_id=c.id group by c.source
), stats as (
 select count(*)::int total from cohort
)
select jsonb_build_object(
 'total_enrollments',(select total from stats),
 'missing_origin',(select count(*)::int from cohort where source='not_informed'),
 'channels',coalesce((select jsonb_agg(jsonb_build_object(
  'source',b.source,'enrollments',b.enrollments,'revenue',b.revenue,
  'percentage',round(100.0*b.enrollments/nullif((select total from stats),0),1))
  order by b.enrollments desc,b.source) from by_source b),'[]'::jsonb),
 'reservations',(select count(*)::int from private.promotion_reservations
  where created_at>=now()-(least(greatest(coalesce(period_days,30),1),3650)*interval '1 day')),
 'trials',(select count(*)::int from private.trial_lesson_appointments
  where created_at>=now()-(least(greatest(coalesce(period_days,30),1),3650)*interval '1 day'))
)
where public.is_teacher_admin();
$$;
revoke all on function public.get_my_student_acquisition(),public.set_my_student_acquisition(text,text,jsonb),
 public.get_teacher_student_acquisitions(),public.set_teacher_student_acquisition(uuid,text,text),
 public.get_teacher_lead_acquisitions(),public.set_teacher_lead_acquisition(text,uuid,text,text),
 public.get_teacher_declared_acquisition_report(integer) from public,anon;
grant execute on function public.get_my_student_acquisition(),public.set_my_student_acquisition(text,text,jsonb),
 public.get_teacher_student_acquisitions(),public.set_teacher_student_acquisition(uuid,text,text),
 public.get_teacher_lead_acquisitions(),public.set_teacher_lead_acquisition(text,uuid,text,text),
 public.get_teacher_declared_acquisition_report(integer) to authenticated;

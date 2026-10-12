-- Wrappers transacionais preservam a reserva/agendamento quando a gravação da origem falha.
create or replace function public.save_teacher_promotion_reservation_with_origin(target_id uuid,input jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved uuid;
begin
 saved := public.save_teacher_promotion_reservation(target_id,input);
 perform public.set_teacher_lead_acquisition('reservation',saved,
   nullif(input->>'declared_source',''),input->>'source_detail');
 return saved;
end; $$;
create or replace function public.create_teacher_trial_lesson_with_origin(
 target_name text,target_english_level text,target_whatsapp text,
 target_mode text,target_date date,target_time time without time zone,
 target_class_number integer,target_source text,target_detail text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare saved uuid;
begin
 saved := public.create_teacher_trial_lesson(target_name,target_english_level,target_whatsapp,
 target_mode,target_date,target_time,target_class_number);
 perform public.set_teacher_lead_acquisition('trial',saved,target_source,target_detail);
 return saved;
end; $$;
create or replace function public.update_teacher_trial_lesson_with_origin(
 target_appointment_id uuid,target_name text,target_english_level text,target_whatsapp text,
 target_mode text,target_date date,target_time time without time zone,
 target_class_number integer,target_source text,target_detail text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.update_teacher_trial_lesson(target_appointment_id,target_name,target_english_level,
 target_whatsapp,target_mode,target_date,target_time,target_class_number);
 perform public.set_teacher_lead_acquisition('trial',target_appointment_id,target_source,target_detail);
end; $$;
revoke all on function public.save_teacher_promotion_reservation_with_origin(uuid,jsonb),
 public.create_teacher_trial_lesson_with_origin(text,text,text,text,date,time without time zone,integer,text,text),
 public.update_teacher_trial_lesson_with_origin(uuid,text,text,text,text,date,time without time zone,integer,text,text) from public,anon;
grant execute on function public.save_teacher_promotion_reservation_with_origin(uuid,jsonb),
 public.create_teacher_trial_lesson_with_origin(text,text,text,text,date,time without time zone,integer,text,text),
 public.update_teacher_trial_lesson_with_origin(uuid,text,text,text,text,date,time without time zone,integer,text,text) to authenticated;
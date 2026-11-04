-- Existing public waitlist contacts must not be mutable by unauthenticated
-- callers who merely know (or guess) their WhatsApp number.
-- Duplicates remain idempotent without exposing registration status.
-- Teacher-only management RPCs retain full authority to resolve leads.

CREATE OR REPLACE FUNCTION public.join_public_class_seat_waitlist(target_class_number integer, target_name text, target_whatsapp text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare normalized text := private.normalize_trial_phone(target_whatsapp);
begin
  if length(btrim(coalesce(target_name,''))) not between 2 and 120 or normalized is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos.' using errcode='22023';
  end if;
  -- Any valid Brazilian WhatsApp is accepted, even if different from the trial contact.
  perform 1 from public.teacher_classes
  where class_number=target_class_number and is_active and class_type='quintet';
  if not found then raise exception 'Turma indisponível.' using errcode='22023'; end if;
  insert into private.class_seat_waitlist(class_number,applicant_name,whatsapp,normalized_phone)
  values(target_class_number,btrim(target_name),btrim(target_whatsapp),normalized)
  on conflict (class_number, normalized_phone) do nothing;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_public_class_seat_waitlist(target_class_number integer, target_name text, target_whatsapp text, target_client_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  applicant_key text := private.class_seat_applicant_key(target_whatsapp,target_client_key);
  applicant_name text := btrim(coalesce(target_name,''));
begin
  if length(applicant_name) not between 2 and 120 or
     private.normalize_trial_phone(target_whatsapp) is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos para a lista de espera.' using errcode='22023';
  end if;

  perform 1 from public.teacher_classes
  where class_number=target_class_number and is_active and class_type='quintet'
    and class_weekday is not null and class_start_time is not null;
  if not found then raise exception 'Turma indisponível.' using errcode='22023'; end if;

  insert into private.class_seat_waitlist(
    class_number,applicant_name,whatsapp,normalized_phone
  ) values (
    target_class_number,applicant_name,
    nullif(btrim(coalesce(target_whatsapp,'')),''),applicant_key
  )
  on conflict (class_number, normalized_phone) do nothing;
  return true;
end;
$function$;

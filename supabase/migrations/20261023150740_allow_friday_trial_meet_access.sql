-- Add the Friday 15h experimental lesson without changing existing access records.
alter table private.trial_meet_accesses
  drop constraint trial_meet_accesses_lesson_slot_check,
  add constraint trial_meet_accesses_lesson_slot_check
    check (lesson_slot in ('monday_18', 'tuesday_10', 'tuesday_15', 'thursday_20', 'friday_15'));

create or replace function public.record_trial_meet_access(
  target_request_id uuid, target_name text, target_whatsapp_digits text, target_lesson_slot text
) returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
  clean_name text := btrim(regexp_replace(coalesce(target_name, ''), '[[:space:]]+', ' ', 'g'));
begin
  if target_request_id is null
     or char_length(clean_name) not between 2 and 120
     or coalesce(target_whatsapp_digits, '') !~ '^[0-9]{10,15}$'
     or target_lesson_slot not in ('monday_18', 'tuesday_10', 'tuesday_15', 'thursday_20', 'friday_15')
  then
    raise exception 'Dados da aula experimental inválidos.' using errcode = '22023';
  end if;
  insert into private.trial_meet_accesses (request_id, visitor_name, whatsapp_digits, lesson_slot)
  values (target_request_id, clean_name, target_whatsapp_digits, target_lesson_slot)
  on conflict (request_id) do nothing;
  return true;
end;
$function$;

revoke all on function public.record_trial_meet_access(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_trial_meet_access(uuid,text,text,text)
  to service_role;

create table if not exists private.trial_meet_accesses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  visitor_name text not null check (char_length(btrim(visitor_name)) between 2 and 120),
  whatsapp_digits text not null check (whatsapp_digits ~ '^[0-9]{10,15}$'),
  lesson_slot text not null check (lesson_slot in ('monday_18', 'tuesday_10', 'tuesday_15', 'thursday_20')),
  accessed_at timestamptz not null default clock_timestamp()
);
alter table private.trial_meet_accesses enable row level security;
revoke all on table private.trial_meet_accesses from public, anon, authenticated;
grant select, insert on table private.trial_meet_accesses to service_role;
create index if not exists trial_meet_accesses_accessed_at_idx
  on private.trial_meet_accesses(accessed_at desc);
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
     or target_lesson_slot not in ('monday_18', 'tuesday_10', 'tuesday_15', 'thursday_20')
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
create or replace function public.get_teacher_trial_meet_accesses()
returns table (id uuid, visitor_name text, whatsapp_digits text, lesson_slot text, accessed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;
  return query
    select record.id, record.visitor_name, record.whatsapp_digits, record.lesson_slot, record.accessed_at
    from private.trial_meet_accesses record
    order by record.accessed_at desc
    limit 300;
end;
$function$;
revoke all on function public.get_teacher_trial_meet_accesses() from public, anon;
grant execute on function public.get_teacher_trial_meet_accesses() to authenticated, service_role;
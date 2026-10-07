set lock_timeout = '5s';
set statement_timeout = '60s';

-- Backfill the existing inconsistent state.
update public.student_billing_settings billing
set active = false,
    updated_at = now()
where billing.active = true
  and exists (
    select 1
    from public.profiles profile
    where profile.id = billing.student_id
      and coalesce(profile.archived, false) = true
  );

-- Keep academic and billing state aligned whenever a profile becomes archived.
create or replace function private.apply_archived_student_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.class_students
  where user_id = new.id;

  update public.student_billing_settings
  set active = false,
      updated_at = now()
  where student_id = new.id
    and active = true;

  return new;
end;
$$;

revoke all on function private.apply_archived_student_invariants()
from public, anon, authenticated;

drop trigger if exists detach_archived_student_class_memberships_on_insert
on public.profiles;

drop trigger if exists detach_archived_student_class_memberships_on_update
on public.profiles;

drop trigger if exists apply_archived_student_invariants_on_insert
on public.profiles;

drop trigger if exists apply_archived_student_invariants_on_update
on public.profiles;

create trigger apply_archived_student_invariants_on_insert
after insert on public.profiles
for each row
when (new.archived is true)
execute function private.apply_archived_student_invariants();

create trigger apply_archived_student_invariants_on_update
after update of archived on public.profiles
for each row
when (
  new.archived is true
  and old.archived is distinct from true
)
execute function private.apply_archived_student_invariants();

drop function if exists private.detach_archived_student_class_memberships();

-- Prevent any later write from reactivating billing while the student remains archived.
create or replace function private.prevent_archived_student_billing_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active is true
     and exists (
       select 1
       from public.profiles profile
       where profile.id = new.student_id
         and coalesce(profile.archived, false) = true
     )
  then
    raise exception 'A cobrança não pode ser ativada para um aluno arquivado.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_archived_student_billing_activation()
from public, anon, authenticated;

drop trigger if exists prevent_archived_student_billing_activation_trigger
on public.student_billing_settings;

create trigger prevent_archived_student_billing_activation_trigger
before insert or update of student_id, active on public.student_billing_settings
for each row
execute function private.prevent_archived_student_billing_activation();

comment on function private.apply_archived_student_invariants() is
  'When a student is archived, removes class memberships and deactivates billing settings in the same transaction.';

comment on function private.prevent_archived_student_billing_activation() is
  'Rejects attempts to activate billing settings while the related student profile is archived.';

do $$
begin
  if exists (
    select 1
    from public.student_billing_settings billing
    join public.profiles profile on profile.id = billing.student_id
    where billing.active = true
      and coalesce(profile.archived, false) = true
  ) then
    raise exception 'Archived student billing invariant was not established.';
  end if;
end;
$$;

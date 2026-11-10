-- Reduce profile update privileges while preserving legacy browser compatibility.
-- RLS remains active; existing triggers protect enrolled, enrollment_code and class_type.
revoke update on table public.profiles from authenticated;

grant update (
  id,
  name,
  email,
  cpf,
  whatsapp,
  enrollment_code,
  enrolled,
  pix_key,
  availability,
  availability_seg_09,
  availability_seg_10,
  availability_seg_12,
  availability_seg_13,
  availability_seg_15,
  availability_seg_17,
  availability_seg_18,
  availability_seg_20,
  availability_seg_21,
  availability_ter_09,
  availability_ter_10,
  availability_ter_12,
  availability_ter_13,
  availability_ter_15,
  availability_ter_17,
  availability_ter_18,
  availability_ter_20,
  availability_ter_21,
  availability_qua_09,
  availability_qua_10,
  availability_qua_12,
  availability_qua_13,
  availability_qua_15,
  availability_qua_17,
  availability_qua_18,
  availability_qua_20,
  availability_qua_21,
  availability_qui_09,
  availability_qui_10,
  availability_qui_12,
  availability_qui_13,
  availability_qui_15,
  availability_qui_17,
  availability_qui_18,
  availability_qui_20,
  availability_qui_21,
  availability_sex_09,
  availability_sex_10,
  availability_sex_12,
  availability_sex_13,
  availability_sex_15,
  availability_sex_17,
  availability_sex_18,
  availability_sex_20,
  availability_sex_21,
  class_type,
  profile_completed,
  date_of_birth
) on table public.profiles to authenticated;

do $verify$
declare
  protected_column text;
  editable_column text;
begin
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    raise exception 'Authenticated users retained table-level UPDATE.';
  end if;

  foreach protected_column in array array['created_at', 'exercise_schedule_start_date', 'archived', 'archived_at', 'first_portal_access_at', 'last_portal_access_at', 'tuition_due_day', 'tuition_due_day_anchor_date', 'tuition_due_day_selected_at', 'tuition_first_due_date', 'tuition_due_day_source', 'enrolled_at', 'first_payment_same_day_required', 'access_mode']
  loop
    if has_column_privilege('authenticated', 'public.profiles', protected_column, 'UPDATE') then
      raise exception 'Protected profile column is still writable: %', protected_column;
    end if;
  end loop;

  foreach editable_column in array array['name', 'whatsapp', 'availability', 'date_of_birth', 'profile_completed', 'enrolled', 'enrollment_code', 'class_type']
  loop
    if not has_column_privilege('authenticated', 'public.profiles', editable_column, 'UPDATE') then
      raise exception 'Required legacy profile column lost UPDATE: %', editable_column;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.profiles', 'UPDATE') then
    raise exception 'Service role must retain profile management.';
  end if;
end;
$verify$;
-- Reject malformed availability values even if supplied outside the page.
create function private.valid_promotion_availability(value jsonb)
returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(value)<>'array' then false
 when jsonb_array_length(value)>60 then false
 else not exists (
  select 1 from jsonb_array_elements_text(value) as slot(value)
  where split_part(slot.value,'|',1) not in ('seg','ter','qua','qui','sex')
   or split_part(slot.value,'|',2) not in ('09:00','10:00','12:00','13:00','15:00','17:00','18:00','20:00','21:00')
   or length(slot.value)-length(replace(slot.value,'|',''))<>1
 ) end;
$$;
alter table private.promotion_reservations add constraint promotion_reservations_availability_valid
check (private.valid_promotion_availability(availability));
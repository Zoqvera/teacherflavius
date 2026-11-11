-- Read only the confirmation e-mail status for the current student's own
-- replacement booking. The address comes from the booking, not the auth UI:
-- the booking RPC may prefer the profile address over auth.users.email.
create or replace function public.get_my_replacement_booking_email_status(
  target_booking_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  recipient_email text;
  email_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Faça login para consultar a confirmação da reposição.'
      using errcode = '42501';
  end if;

  select
    booking.student_email,
    coalesce(notification.status, 'pending')
  into recipient_email, email_status
  from public.makeup_class_bookings as booking
  left join public.makeup_class_email_notifications as notification
    on notification.booking_id = booking.id
   and notification.notification_type = 'booking_confirmation'
  where booking.id = target_booking_id
    and booking.student_id = (select auth.uid())
    and booking.booking_kind = 'replacement'
    and booking.status = 'confirmed';

  if not found then
    raise exception 'Reposição não encontrada para este aluno.'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'recipient_email', recipient_email,
    'status', email_status
  );
end;
$function$;

revoke all on function public.get_my_replacement_booking_email_status(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_replacement_booking_email_status(uuid)
  to authenticated, service_role;

comment on function public.get_my_replacement_booking_email_status(uuid)
is 'Returns only the current student replacement confirmation recipient and provider-accepted status.';

notify pgrst, 'reload schema';

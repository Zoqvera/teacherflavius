-- Retire voluntary late-payment policy. Preserve historical acceptance audit.
update private.late_payment_charge_settings
set enabled = false
where singleton = true;

revoke execute on function public.accept_my_late_payment_terms(text) from authenticated;
revoke execute on function public.get_my_late_payment_terms() from authenticated;
revoke execute on function public.get_my_late_tuition_quote(uuid) from authenticated;
revoke execute on function public.get_checkout_late_tuition_quote(uuid) from service_role;
notify pgrst, 'reload schema';

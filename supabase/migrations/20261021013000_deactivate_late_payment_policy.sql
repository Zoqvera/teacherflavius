-- Prevent future policy acceptance; keep historical consents for audit.
revoke execute on function public.accept_my_late_payment_terms(text) from authenticated;

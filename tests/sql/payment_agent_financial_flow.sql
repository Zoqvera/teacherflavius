-- Synthetic isolated fixture only: never run this test on production data.
-- The fixture must contain the administrator and unpaid tuition IDs below.
begin;
set local role teacher_payment_agent;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"teacher_payment_agent"}', true);
select public.record_tuition_payment('22222222-2222-4222-8222-222222222222', '2026-11-04', 50, 'pix', null);

do $$
begin
  begin
    perform public.record_tuition_payment('22222222-2222-4222-8222-222222222222', '2026-11-04', 50, 'pix', null);
    raise exception 'A duplicate payment was accepted';
  exception when others then
    if sqlerrm not like '%já está paga%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"teacher_payment_agent"}', true);
  begin
    perform public.record_tuition_payment('22222222-2222-4222-8222-222222222222', '2026-11-04', 50, 'pix', null);
    raise exception 'A non-administrator was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.monthly_tuition m
    join public.monthly_tuition_events e on e.tuition_id = m.id
    where m.id = '22222222-2222-4222-8222-222222222222'
      and m.amount_paid = 50 and m.payment_method = 'pix'
      and m.updated_by = '11111111-1111-4111-8111-111111111111'
      and e.actor_id = m.updated_by and e.action = 'payment_recorded'
  ) then raise exception 'Payment or audit record did not match'; end if;
end;
$$;
rollback;

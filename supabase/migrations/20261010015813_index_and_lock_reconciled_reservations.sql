-- Keep private reservation foreign keys efficient and lock reconciled reservations in the enrolled state.
create index promotion_reservation_audit_reservation_idx
  on private.promotion_reservation_audit(reservation_id, created_at desc);
create index promotion_reservation_audit_actor_idx
  on private.promotion_reservation_audit(actor_id);
create index promotion_reservations_creator_idx
  on private.promotion_reservations(created_by);
create index promotion_reservations_trial_idx
  on private.promotion_reservations(linked_trial_id);
alter table private.promotion_reservations
 add constraint promotion_credit_requires_enrolled
 check (credit_applied_tuition_id is null or status='enrolled');
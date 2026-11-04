-- Extra row-level protection for canonical internal billing plans.
-- Production migration version: 20261104013111.
alter table private.billing_plans enable row level security;

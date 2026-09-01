drop policy if exists "deny_direct_marketing_acquisition_access" on public.marketing_acquisition_events;
create policy "deny_direct_marketing_acquisition_access"
  on public.marketing_acquisition_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.data_retention_policies (
  dataset,
  category,
  source_table,
  timestamp_column,
  retention_days,
  automatic_purge,
  enabled,
  rationale,
  last_reviewed_at,
  next_review_at
) values (
  'marketing_acquisition_events',
  'analytics',
  'marketing_acquisition_events',
  'occurred_at',
  400,
  true,
  true,
  'Eventos pseudonimizados de aquisição são mantidos por até 400 dias para permitir comparações anuais e depois expurgados automaticamente.',
  now(),
  current_date + 180
)
on conflict (dataset) do update set
  category = excluded.category,
  source_table = excluded.source_table,
  timestamp_column = excluded.timestamp_column,
  retention_days = excluded.retention_days,
  automatic_purge = excluded.automatic_purge,
  enabled = excluded.enabled,
  rationale = excluded.rationale,
  last_reviewed_at = excluded.last_reviewed_at,
  next_review_at = excluded.next_review_at;

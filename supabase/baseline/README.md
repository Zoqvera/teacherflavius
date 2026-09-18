# Supabase production baseline

This directory is the canonical schema-only reconstruction baseline for the Teacherflavius production database.

The original snapshot was captured after production migration `20260820225434_harden_notification_webhook_vault_dispatcher`. Small, explicitly ordered corrective overlays may follow the snapshot when a production integrity fix must also be guaranteed during disaster recovery.

## Why this baseline exists

The production `supabase_migrations.schema_migrations` ledger contains historical entries that are not fully reconstructable from repository migrations alone. In addition, the remote ledger begins after some core application tables already existed, so replaying the ledger alone cannot reconstruct an empty database.

A literal public copy of the historical ledger is also unsafe: migration `20260819081121_google_only_student_account_linking` contains real student email addresses. Those values must not become permanent history in this public repository.

For those reasons, the current production schema is the reconstruction source of truth. `migration-ledger.csv` records remote version/name information for audit without publishing historical personal data.

## Restore order

Use a fresh Supabase project with the same PostgreSQL major version and standard Supabase-managed `auth`/`storage` schemas.

1. Apply `10_public_schema.sql`.
2. Apply `20_default_privileges.sql`.
3. Apply `30_platform_config.sql`.
4. Apply `35_preserve_referenced_auto_makeup_slots.sql`.
5. Apply `40_allow_gmail_dot_equivalent_student_links.sql`.
6. Apply `45_add_study_lesson_pages.sql`.
7. Provision the Vault secret named `teacherflavius_notification_webhook_secret` out-of-band. Never commit its value.
8. Deploy the Edge Functions and their environment secrets from the normal application deployment path.
9. Restore application data separately, if a data restore is required.
10. Compare the restored catalog against `schema-fingerprint.json` before directing traffic to it.
11. Only after the restored schema has been verified, reconcile migration-history status using the current Supabase CLI `migration repair` workflow and `migration-ledger.csv`. Do not replay the historical migrations on top of this baseline.

## Important boundaries

- This is schema only. It contains no student rows, payment rows, auth users, CPF values, email addresses, or Vault secret values.
- Storage currently has no buckets and no custom Storage RLS policies.
- Application Cron jobs are recreated by `30_platform_config.sql`; corrective function overlays are applied afterward.
- Supabase-managed internals in `auth`, `storage`, `realtime`, GraphQL, and extension schemas are not duplicated. Application-owned auth triggers are captured by `10_public_schema.sql`.
- Application-owned objects in schema `private` are included in `10_public_schema.sql` before triggers that reference them.
- `supabase/migrations/` remains historical development material; it is not a complete fresh-database replay chain. For disaster recovery, use this baseline plus a verified data backup.

## Validation fingerprint

`schema-fingerprint.json` is the machine-readable catalog fingerprint used to detect structural drift. Function-body-only overlays do not change catalog object counts. Overlay `40_allow_gmail_dot_equivalent_student_links.sql` adds one helper function, so the public-function count is intentionally incremented by one.

## Disposable restore validation

Before merging baseline changes, `.github/workflows/validate-supabase-baseline.yml` starts a clean local Supabase stack in GitHub Actions, applies the committed SQL baseline in documented order without replaying the incomplete historical migrations, provisions only a dummy Vault secret, verifies the Gmail dot-equivalence access boundary, and compares the restored catalog against `schema-fingerprint.json`. Production credentials and application data are never used by this test.

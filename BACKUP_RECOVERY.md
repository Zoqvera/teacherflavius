# Database backup and recovery

This document describes the independent logical backup and disaster-recovery verification layer for the Teacherflavius production database.

## Protection model

The repository keeps two complementary recovery layers:

- `supabase/baseline/`: versioned application-owned schema and platform configuration.
- encrypted GitHub Actions artifacts: production roles, schema, data, migration history and a technical recovery fingerprint.

`.github/workflows/supabase-encrypted-backup.yml` creates the encrypted artifact. `.github/workflows/supabase-backup-recovery-test.yml` is triggered after a successful backup and restores that artifact into a disposable local Supabase stack.

This repository-defined backup exists independently of any managed Supabase backup capability available to the project.

Supabase Storage object bytes are not part of a database logical backup. The recovery verifier therefore fails deliberately if the production manifest reports any Storage buckets or objects. At the time this recovery layer was introduced, production had zero buckets and zero objects.

## Required GitHub repository secrets

### `SUPABASE_DB_URL`

Use the production database connection string from the Supabase **Connect** panel. Prefer the Session Pooler connection string for CI reliability. It contains the database password and must never be committed.

Example shape only:

```text
postgresql://postgres.<project-ref>:<database-password>@<pooler-host>:5432/postgres
```

### `BACKUP_ENCRYPTION_PASSPHRASE`

Use a unique random passphrase of at least 32 characters. Keep a protected copy outside GitHub. If this passphrase is lost, the encrypted artifacts cannot be recovered.

Never place either secret in source files, issues, pull-request comments, Actions logs or documentation.

## Schedule, retention and recovery objectives

The backup workflow runs every day at `03:17 UTC`, currently `00:17` in `America/Sao_Paulo`.

- normal daily backup: retained for 30 days;
- backup created on the first day of each month: retained for 90 days;
- design RPO from repository scheduling: 24 hours;
- RTO exercise: measured on every automated disposable restore and written to the Actions step summary and recovery report artifact.

The 24-hour RPO is a design target based on backup cadence, not a guarantee that GitHub Actions will start at the exact scheduled second. The measured restore duration is a laboratory recovery exercise and is not a guarantee of full production cutover time, which also includes DNS, Edge Functions, secrets, Auth configuration and external integrations.

## Backup contents

Each successful encrypted archive contains:

- `roles.sql`
- `schema.sql`
- `data.sql`
- `history_schema.sql`
- `history_data.sql`
- `recovery_manifest.json`
- `manifest.sha256`
- `README.txt`

The backup follows the Supabase CLI logical dump pattern. The payload is packed and encrypted symmetrically with GnuPG AES-256 before upload. Plaintext database material is removed from the runner before the artifact is published.

The external `.sha256` file is generated with a portable basename so it can be validated after the artifact is downloaded in a different GitHub Actions run.

## Recovery manifest

`supabase/recovery/recovery_manifest.sql` is the single source of truth used to fingerprint both production at backup time and the disposable restored database.

Manifest format version 2 contains technical counts/configuration only and no row contents or secret values. It covers:

- profiles;
- Auth users, identities and MFA factors;
- monthly tuition records;
- payment attempts;
- makeup-class slots;
- public/private catalog counts, constraints, indexes, RLS policies and application triggers;
- Supabase Storage bucket/object counts;
- definitions and active state of the eight application-owned Cron jobs.

This makes Auth preservation an explicit recovery assertion rather than an assumption about CLI behavior.

## Backup self-check

Before an artifact is uploaded, `scripts/create_encrypted_supabase_backup.sh`:

1. validates required secrets;
2. creates the logical dump set;
3. captures `recovery_manifest.json`;
4. hashes every plaintext backup component into `manifest.sha256`;
5. archives and encrypts the set with AES-256;
6. creates a portable SHA-256 for the encrypted payload;
7. decrypts the new payload in the same runner;
8. extracts it and verifies `manifest.sha256`;
9. removes all plaintext working material.

A failure in any step fails the backup workflow.

## Automated restore verification

After a successful `Encrypted Supabase logical backup` run, `Verify Supabase backup recovery` starts automatically with read-only repository/Actions permissions plus access to the backup passphrase secret.

The verifier:

1. downloads the encrypted artifact from the completed backup run;
2. validates the encrypted payload SHA-256;
3. decrypts and extracts the archive;
4. validates every internal file against `manifest.sha256`;
5. rejects the backup as incomplete if Storage contains buckets or objects;
6. starts a clean disposable Supabase stack with no application migration history pre-applied;
7. restores `roles.sql`, `schema.sql` and `data.sql` in one transaction with `session_replication_role = replica`;
8. restores the backed-up `supabase_migrations` history separately;
9. recreates the eight application-owned Cron definitions from `supabase/baseline/30_platform_config.sql`;
10. captures a new manifest from the restored database using the same SQL as production;
11. disables the disposable Cron jobs before committing the platform-configuration transaction so the test environment cannot execute scheduled external work;
12. removes the volatile `captured_at` field and requires the remaining restored fingerprint to match the backup fingerprint exactly;
13. records the restore/verification duration as `rto_exercise_seconds`;
14. destroys the disposable Supabase stack.

A backup is therefore considered recovery-verified only when the second workflow succeeds, not merely when the encrypted file exists.

## Manual decryption

Assuming the downloaded encrypted file is named `teacherflavius-YYYYMMDDTHHMMSSZ.tar.gz.gpg`:

```bash
gpg --batch --yes --pinentry-mode loopback \
  --output teacherflavius-backup.tar.gz \
  --decrypt teacherflavius-YYYYMMDDTHHMMSSZ.tar.gz.gpg

mkdir teacherflavius-backup
tar -xzf teacherflavius-backup.tar.gz -C teacherflavius-backup
cd teacherflavius-backup
sha256sum --check manifest.sha256
```

GnuPG requests the recovery passphrase unless supplied through a secure local secret mechanism.

## Manual restore order

For an actual disaster recovery into a replacement Supabase project:

1. create the replacement project and obtain its database connection string;
2. decrypt the selected recovery-verified artifact and verify both SHA-256 layers;
3. restore `roles.sql`, `schema.sql` and `data.sql` using a single transaction and `SET session_replication_role = replica` for the data import;
4. restore `history_schema.sql` and `history_data.sql` separately;
5. apply `supabase/baseline/30_platform_config.sql` to recreate application-owned Cron jobs;
6. provision Vault values, Edge Function secrets, OAuth providers, SMTP settings, API keys and other environment-specific configuration out-of-band;
7. deploy Edge Functions from the repository;
8. validate `recovery_manifest.json` against the replacement database;
9. run critical application smoke tests before routing production traffic.

Do not blindly replay the repository's incomplete historical migration chain on top of the validated recovery path.

## Application verification before cutover

Verify at minimum:

- authentication, password/social identities and admin MFA;
- student profiles and enrollments;
- monthly tuition and payment attempts;
- makeup-class slots/bookings;
- flashcards, exercises and practice history;
- teacher/admin access;
- RLS policies and critical triggers;
- all eight Cron definitions;
- Edge Function deployment and secrets;
- Mercado Pago and notification integrations;
- OAuth and SMTP configuration.

## Security notes

The repository is public. Backup artifacts must be treated as potentially discoverable by repository readers. Production database material is therefore encrypted before upload; plaintext backup data must never be committed, attached to issues, published as release assets or uploaded as unencrypted Actions artifacts.

`recovery_manifest.json` is kept inside the encrypted archive even though it contains only technical counts/configuration. Recovery report artifacts intentionally contain status/timing metadata only, not database counts or user data.

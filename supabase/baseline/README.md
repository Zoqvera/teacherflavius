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
6. Apply `42_require_live_admin_auth_session.sql`.
7. Apply `45_add_study_lesson_pages.sql`.
8. Apply `50_enable_dynamic_study_roadmap_cards.sql`.
9. Apply `55_add_lesson_number_label_and_translation.sql`.
10. Apply `60_add_students_of_day.sql`.
11. Apply `65_allow_student_two_class_links.sql`.
12. Apply `70_add_mercado_pago_subscription_foundation.sql`.
13. Apply `75_add_mercado_pago_subscription_reconciliation.sql`.
14. Apply `80_add_mercado_pago_subscription_sandbox.sql`.
15. Apply `85_hide_trial_lessons_from_students_of_day.sql`.
16. Apply `90_add_conversation_questions.sql`.
17. Apply `95_unlock_next_tuition_two_days_after_payment.sql`.
18. Apply `100_require_enrollment_access_code.sql`.
19. Apply `105_require_all_enrollment_fields.sql`.
20. Apply `110_auto_assign_tuition_due_seven_days_after_enrollment.sql`.
21. Apply `115_set_quintet_capacity_eight.sql`.
22. Apply `120_limit_course_vacancies_to_three.sql`.
23. Apply `125_show_sold_out_course_classes.sql`.
24. Apply `130_enforce_tuition_after_enrollment.sql`.
25. Apply `135_allow_tuition_due_date_correction_audit.sql`.
26. Apply `140_lesson_credits_and_my_lessons.sql`.
27. Apply `145_student_sets_enrollment_commercial_terms.sql`.
28. Apply `150_add_academic_lesson_workflow.sql`.
29. Provision the Vault secret named `teacherflavius_notification_webhook_secret` out-of-band. Never commit its value.
30. Deploy the Edge Functions and their environment secrets from the normal application deployment path.
31. Restore application data separately, if a data restore is required.
32. Compare the restored catalog against `schema-fingerprint.json` before directing traffic to it.
33. Only after the restored schema has been verified, reconcile migration-history status using the current Supabase CLI `migration repair` workflow and `migration-ledger.csv`. Do not replay the historical migrations on top of this baseline.

## Important boundaries

- This is schema only. It contains no student rows, payment rows, auth users, CPF values, email addresses, or Vault secret values.
- Storage currently has no buckets and no custom Storage RLS policies.
- Application Cron jobs are recreated by `30_platform_config.sql`; corrective function overlays are applied afterward.
- Supabase-managed internals in `auth`, `storage`, `realtime`, GraphQL, and extension schemas are not duplicated. Application-owned auth triggers are captured by `10_public_schema.sql`.
- Application-owned objects in schema `private` are included in `10_public_schema.sql` before triggers that reference them.
- `supabase/migrations/` remains historical development material; it is not a complete fresh-database replay chain. For disaster recovery, use this baseline plus a verified data backup.

## Validation fingerprint

`schema-fingerprint.json` is the machine-readable catalog fingerprint used to detect structural drift. Function-body-only overlays do not change catalog object counts. Overlay `40_allow_gmail_dot_equivalent_student_links.sql` adds the Gmail helper, `42_require_live_admin_auth_session.sql` restores the current MFA helper, `45_add_study_lesson_pages.sql` adds the lesson audit trigger function, `50_enable_dynamic_study_roadmap_cards.sql` removes the fixed 24-card ceiling, `55_add_lesson_number_label_and_translation.sql` adds the lesson number label and translation constraints, `60_add_students_of_day.sql` restores the students-of-day query, and `65_allow_student_two_class_links.sql` removes the legacy one-class indexes and restores the two-class assignment invariant. Overlay `70_add_mercado_pago_subscription_foundation.sql` adds the server-only recurring-subscription persistence layer and its integrity constraints. Overlay `75_add_mercado_pago_subscription_reconciliation.sql` adds recurring invoice persistence, financial-history preservation, and atomic reconciliation into monthly tuition. Overlay `80_add_mercado_pago_subscription_sandbox.sql` adds isolated, service-role-only evidence storage for subscription sandbox Webhooks without touching production financial tables. Overlay `85_hide_trial_lessons_from_students_of_day.sql` keeps the students-of-day query limited to regular lessons and confirmed makeups while leaving trial appointments in their dedicated workflow. Overlay `90_add_conversation_questions.sql` restores the Conversation Questions catalog, per-student progress table, RLS policies, reordering RPC, and the 99 initial questions. Overlay `150_add_academic_lesson_workflow.sql` adds private lesson-occurrence, preparation, question-study, and spaced-review records plus authenticated RPCs for the student action plan and teacher lesson plan. The fingerprint includes these overlays.

## Disposable restore validation

Before merging baseline changes, `.github/workflows/validate-supabase-baseline.yml` starts a clean local Supabase stack in GitHub Actions, applies the committed SQL baseline in documented order without replaying the incomplete historical migrations, provisions only a dummy Vault secret, verifies the Gmail dot-equivalence access boundary, and compares the restored catalog against `schema-fingerprint.json`. Production credentials and application data are never used by this test.

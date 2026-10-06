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
29. Apply `150_align_first_tuition_with_lesson_start_month.sql`.
30. Apply `155_sync_lesson_cards_and_late_cancellation.sql`.
31. Apply `160_add_conversation_question_cards.sql`.
32. Apply `165_derive_enrollment_lessons_from_fee.sql`.
33. Apply `170_study_questions_individually.sql`.
34. Apply `175_set_first_tuition_before_first_lesson.sql`.
35. Apply `180_limit_first_tuition_to_next_day.sql`.
36. Apply `185_allow_enrollment_day_first_tuition.sql`.
37. Apply `190_add_pwa_web_push_notifications.sql`.
38. Apply `195_initialize_pwa_web_push_keys.sql`.
39. Apply `200_harden_web_push_vapid_bootstrap.sql`.
40. Apply `205_require_cancellation_policy_acceptance.sql`.
41. Apply `210_hide_unpaid_notice_for_prior_payers.sql`.
42. Apply `215_restrict_replacement_options_to_eligible_credits.sql`.
43. Apply `220_align_lesson_cards_with_billing_cycle.sql`.
44. Apply `225_expose_cancelled_lesson_seats_for_replacement.sql`.
45. Apply `230_support_manual_lesson_credit_grants.sql`.
46. Apply `235_activate_first_prepaid_tuition.sql`.
47. Apply `240_require_enrollment_class_mode.sql`.
48. Apply `245_add_enrollment_class_mode_rpc.sql`.
49. Provision the Vault secret `teacherflavius_notification_webhook_secret` out-of-band. Never commit its value. The Web Push cron secret is generated inside Vault by overlay 195.
50. Restore the existing Web Push VAPID key pair out-of-band when subscriptions must survive a disaster recovery. If no pair is restored, the Push sender can generate a new pair and students must re-enable notifications.
51. Deploy the Edge Functions and their environment secrets from the normal application deployment path.
52. Restore application data separately, if a data restore is required.
53. Compare the restored catalog against `schema-fingerprint.json` before directing traffic to it.
54. Only after the restored schema has been verified, reconcile migration-history status using the current Supabase CLI `migration repair` workflow and `migration-ledger.csv`. Do not replay the historical migrations on top of this baseline.

## Important boundaries

- This is schema only. It contains no student rows, payment rows, auth users, CPF values, email addresses, or Vault secret values.
- Storage currently has no buckets and no custom Storage RLS policies.
- Application Cron jobs are recreated by `30_platform_config.sql`; corrective function overlays are applied afterward.
- Supabase-managed internals in `auth`, `storage`, `realtime`, GraphQL, and extension schemas are not duplicated. Application-owned auth triggers are captured by `10_public_schema.sql`.
- Application-owned objects in schema `private` are included in `10_public_schema.sql` before triggers that reference them.
- `supabase/migrations/` remains historical development material; it is not a complete fresh-database replay chain. For disaster recovery, use this baseline plus a verified data backup.

## Validation fingerprint

`schema-fingerprint.json` is the machine-readable catalog fingerprint used to detect structural drift. Function-body-only overlays do not change catalog object counts. Overlay `40_allow_gmail_dot_equivalent_student_links.sql` adds the Gmail helper, `42_require_live_admin_auth_session.sql` restores the current MFA helper, `45_add_study_lesson_pages.sql` adds the lesson audit trigger function, `50_enable_dynamic_study_roadmap_cards.sql` removes the fixed 24-card ceiling, `55_add_lesson_number_label_and_translation.sql` adds the lesson number label and translation constraints, `60_add_students_of_day.sql` restores the students-of-day query, and `65_allow_student_two_class_links.sql` removes the legacy one-class indexes and restores the two-class assignment invariant. Overlay `70_add_mercado_pago_subscription_foundation.sql` adds the server-only recurring-subscription persistence layer and its integrity constraints. Overlay `75_add_mercado_pago_subscription_reconciliation.sql` adds recurring invoice persistence, financial-history preservation, and atomic reconciliation into monthly tuition. Overlay `80_add_mercado_pago_subscription_sandbox.sql` adds isolated, service-role-only evidence storage for subscription sandbox Webhooks without touching production financial tables. Overlay `85_hide_trial_lessons_from_students_of_day.sql` keeps the students-of-day query limited to regular lessons and confirmed makeups while leaving trial appointments in their dedicated workflow. Overlay `90_add_conversation_questions.sql` restores the historical Conversation Questions catalog, per-student progress table, RLS policies, and reordering RPC. Overlay `150_add_academic_lesson_workflow.sql` adds private lesson-occurrence, preparation, question-study, and spaced-review records plus authenticated RPCs for the student action plan and teacher lesson plan. Overlay `150_align_first_tuition_with_lesson_start_month.sql` keeps first tuition aligned to the student's lesson-start month. Overlay `155_sync_lesson_cards_and_late_cancellation.sql` synchronizes settled lesson credits and preserves late cancellations without granting replacement credit. Overlay `160_add_conversation_question_cards.sql` reconciles the catalog to 104 questions and stores the Portuguese translation plus exactly five modeled answer examples for every question. Overlay `190_add_pwa_web_push_notifications.sql` adds private Web Push subscriptions and delivery state, authenticated subscription RPCs, a signed scheduler, and the one-minute notification job. Overlay `195_initialize_pwa_web_push_keys.sql` generates the scheduler credential inside Vault and provides service-role-only VAPID bootstrap without committing private key material. Overlay `200_harden_web_push_vapid_bootstrap.sql` serializes first-use key creation so concurrent activation requests cannot rotate the VAPID pair. Overlay `205_require_cancellation_policy_acceptance.sql` restores the mandatory cancellation-policy acknowledgement. Overlay `210_hide_unpaid_notice_for_prior_payers.sql` keeps the first-payment warning restricted to students who have never settled a tuition. Overlay `215_restrict_replacement_options_to_eligible_credits.sql` limits replacement vacancies to credits earned from on-time cancellations and to class occurrences with exactly four open spots. Overlay `220_align_lesson_cards_with_billing_cycle.sql` keeps paid lesson access active until the next tuition due date and generates lesson cards from that billing-cycle interval instead of the calendar month. Overlay `225_expose_cancelled_lesson_seats_for_replacement.sql` exposes seats released by regular lesson cancellations for replacement booking while preserving the exact-four-spots rule for ordinary vacancies. Overlay `230_support_manual_lesson_credit_grants.sql` adds durable teacher-issued replacement credits without inventing cancellation history and keeps them separate from contractual lesson cards. Overlay `235_activate_first_prepaid_tuition.sql` keeps prepaid lesson coverage active from the payment date. Overlay `240_require_enrollment_class_mode.sql` requires new students to choose individual or group lessons and restricts completed enrollment classification to INDIVIDUAL or QUINTETO. Overlay `245_add_enrollment_class_mode_rpc.sql` persists that choice through the authorized enrollment flow while preserving protected profile fields. The fingerprint includes these overlays.

## Disposable restore validation

Before merging baseline changes, `.github/workflows/validate-supabase-baseline.yml` starts a clean local Supabase stack in GitHub Actions, applies the committed SQL baseline in documented order without replaying the incomplete historical migrations, provisions only a dummy Vault secret, verifies the Gmail dot-equivalence access boundary, and compares the restored catalog against `schema-fingerprint.json`. Production credentials and application data are never used by this test.

# Full Test Suite Inventory & Verification Gate

### tests/unit

| File | Status | Pass | Fail | Skip | Duration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `tests/unit/anonymize-user-data-e2e.test.mjs` | ✅ PASS | 1 | 0 | 0 | 0.35s |
| `tests/unit/build-secret-safety.test.mjs` | ✅ PASS | 2 | 0 | 0 | 0.23s |
| `tests/unit/cashfree-adapter.test.mjs` | ✅ PASS | 7 | 0 | 0 | 0.14s |
| `tests/unit/cashfree-database-schema.test.mjs` | ✅ PASS | 3 | 0 | 0 | 0.11s |
| `tests/unit/cashfree-refund-integration.test.mjs` | ✅ PASS | 3 | 0 | 0 | 0.12s |
| `tests/unit/cashfree-webhook-idempotency.test.mjs` | ✅ PASS | 4 | 0 | 0 | 0.12s |
| `tests/unit/cron-deduplication.test.mjs` | ✅ PASS | 10 | 0 | 0 | 0.24s |
| `tests/unit/cross-tenant-authorization-matrix.test.mjs` | ✅ PASS | 40 | 0 | 0 | 11.37s |
| `tests/unit/database-advisor-fixes.test.mjs` | ✅ PASS | 5 | 0 | 0 | 3.39s |
| `tests/unit/family-booking-qa-lead.test.mjs` | ✅ PASS | 20 | 0 | 0 | 8.52s |
| `tests/unit/family-booking-security-engineer.test.mjs` | ✅ PASS | 17 | 0 | 0 | 3.95s |
| `tests/unit/git-secrets-and-ci-hygiene.test.mjs` | ✅ PASS | 4 | 0 | 0 | 3.04s |
| `tests/unit/hospital-access-helpers.test.mjs` | ✅ PASS | 7 | 0 | 0 | 0.55s |
| `tests/unit/hospital-admin-screens.test.mjs` | ✅ PASS | 6 | 0 | 0 | 0.61s |
| `tests/unit/hospital-audit-logging.test.mjs` | ✅ PASS | 6 | 0 | 0 | 0.80s |
| `tests/unit/hospital-bookings-rls.test.mjs` | ✅ PASS | 5 | 0 | 0 | 0.60s |
| `tests/unit/hospital-concurrency-safety.test.mjs` | ✅ PASS | 4 | 0 | 0 | 18.94s |
| `tests/unit/hospital-consultant-screens.test.mjs` | ✅ PASS | 8 | 0 | 0 | 0.80s |
| `tests/unit/hospital-customer-screens.test.mjs` | ✅ PASS | 12 | 0 | 0 | 0.62s |
| `tests/unit/hospital-escalation-revocation.test.mjs` | ✅ PASS | 7 | 0 | 0 | 0.73s |
| `tests/unit/hospital-frontdesk-screens.test.mjs` | ✅ PASS | 9 | 0 | 0 | 1.12s |
| `tests/unit/hospital-hardened-rpcs.test.mjs` | ✅ PASS | 7 | 0 | 0 | 1.09s |
| `tests/unit/hospital-lifetime-pin-and-patient-gap.test.mjs` | ✅ PASS | 9 | 0 | 0 | 0.87s |
| `tests/unit/hospital-no-show-policy.test.mjs` | ✅ PASS | 6 | 0 | 0 | 0.31s |
| `tests/unit/hospital-per-consultant-gaps.test.mjs` | ✅ PASS | 6 | 0 | 0 | 0.60s |
| `tests/unit/hospital-push-notifications.test.mjs` | ✅ PASS | 11 | 0 | 0 | 0.58s |
| `tests/unit/hospital-queue-engine.test.mjs` | ✅ PASS | 36 | 0 | 0 | 0.19s |
| `tests/unit/hospital-rbac-security.test.mjs` | ✅ PASS | 14 | 0 | 0 | 0.90s |
| `tests/unit/hospital-server-api-matrix.test.mjs` | ✅ PASS | 12 | 0 | 0 | 1.37s |
| `tests/unit/hospital-split-payment.test.mjs` | ✅ PASS | 7 | 0 | 0 | 1.21s |
| `tests/unit/mantis-track1-database-hardening.test.mjs` | ✅ PASS | 4 | 0 | 0 | 0.49s |
| `tests/unit/mobile-secure-storage.test.mjs` | ✅ PASS | 1 | 0 | 0 | 0.08s |
| `tests/unit/mobile-security-claims.test.mjs` | ✅ PASS | 2 | 0 | 0 | 0.09s |
| `tests/unit/otp-circuit-breaker.test.mjs` | ✅ PASS | 8 | 0 | 0 | 5.94s |
| `tests/unit/phase1-security-blockers.test.mjs` | ✅ PASS | 24 | 0 | 0 | 4.47s |
| `tests/unit/phase2-functional-blockers.test.mjs` | ✅ PASS | 18 | 0 | 0 | 5.57s |
| `tests/unit/phase3-hospital-queue.test.mjs` | ✅ PASS | 10 | 0 | 0 | 0.21s |
| `tests/unit/production-safety-and-guest-ux.test.mjs` | ✅ PASS | 3 | 0 | 0 | 2.87s |
| `tests/unit/queue-scheduler.test.mjs` | ✅ PASS | 5 | 0 | 0 | 0.13s |
| `tests/unit/queue-spec-engine.test.mjs` | ✅ PASS | 8 | 0 | 0 | 0.45s |
| `tests/unit/rate-limit-backend.test.mjs` | ✅ PASS | 10 | 0 | 0 | 0.13s |
| `tests/unit/razorpay-refund-integration.test.mjs` | ✅ PASS | 1 | 0 | 2 | 13.24s |
| `tests/unit/security-audit-database-grants.test.mjs` | ✅ PASS | 6 | 0 | 0 | 8.21s |
| `tests/unit/security-audit-nextjs-dependencies.test.mjs` | ✅ PASS | 1 | 0 | 0 | 0.09s |
| `tests/unit/security-audit-production-env.test.mjs` | ✅ PASS | 6 | 0 | 0 | 0.08s |
| `tests/unit/security-definer-grants-snapshot.test.mjs` | ✅ PASS | 4 | 0 | 0 | 0.14s |
| `tests/unit/security-erasure-and-pii-hardening.test.mjs` | ✅ PASS | 2 | 0 | 0 | 0.13s |
| `tests/unit/web-legal-claims.test.mjs` | ✅ PASS | 4 | 0 | 0 | 0.12s |
| **Category Subtotal (48 files)** | | **405** | **0** | **2** | |

### tests/scripts

| File | Status | Pass | Fail | Skip | Duration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `tests/scripts/test-admin-logs.mjs` | ✅ PASS | 1 | 0 | 0 | 0.11s |
| `tests/scripts/test-checkin-code.mjs` | ✅ PASS | 20 | 0 | 0 | 0.10s |
| `tests/scripts/test-concurrency.mjs` | ✅ PASS | 16 | 0 | 0 | 0.13s |
| `tests/scripts/test-credentials-security.mjs` | ✅ PASS | 5 | 0 | 0 | 0.17s |
| `tests/scripts/test-customer-pagination-and-admin-dashboards.mjs` | ✅ PASS | 3 | 0 | 0 | 0.22s |
| `tests/scripts/test-e2e-logging-and-alerts.mjs` | ✅ PASS | 1 | 0 | 0 | 0.15s |
| `tests/scripts/test-expired-holds-limit.mjs` | ✅ PASS | 4 | 0 | 0 | 0.23s |
| `tests/scripts/test-late-queue.mjs` | ✅ PASS | 15 | 0 | 0 | 0.13s |
| `tests/scripts/test-logging-baseline.mjs` | ✅ PASS | 1 | 0 | 0 | 0.14s |
| `tests/scripts/test-mobile-url-security.mjs` | ✅ PASS | 3 | 0 | 0 | 0.08s |
| `tests/scripts/test-policies-standby-and-doctor-emergency.mjs` | ✅ PASS | 1 | 0 | 0 | 0.17s |
| `tests/scripts/test-profiles-security.mjs` | ✅ PASS | 6 | 0 | 0 | 0.74s |
| `tests/scripts/test-rate-limiting-security.mjs` | ✅ PASS | 5 | 0 | 0 | 0.13s |
| `tests/scripts/test-real-notification-queue.mjs` | ✅ PASS | 1 | 0 | 0 | 0.18s |
| `tests/scripts/test-realtime-fanout.mjs` | ✅ PASS | 1 | 0 | 0 | 4.72s |
| `tests/scripts/test-realtime-state-merge.mjs` | ✅ PASS | 5 | 0 | 0 | 0.16s |
| `tests/scripts/test-routes.mjs` | ✅ PASS | 71 | 0 | 0 | 0.13s |
| `tests/scripts/test-security.mjs` | ✅ PASS | 69 | 0 | 0 | 0.14s |
| `tests/scripts/test-ticket-freshness.mjs` | ✅ PASS | 3 | 0 | 0 | 11.49s |
| `tests/scripts/test-validation.mjs` | ✅ PASS | 85 | 0 | 0 | 0.24s |
| `tests/scripts/test-waitlist-security.mjs` | ✅ PASS | 6 | 0 | 0 | 0.30s |
| `tests/scripts/test-whatsapp-integration.mjs` | ✅ PASS | 1 | 0 | 0 | 0.17s |
| `tests/scripts/demo-live-logs.mjs` | ✅ PASS | 1 | 0 | 0 | 0.07s |
| `tests/scripts/verify-logging.mjs` | ✅ PASS | 18 | 0 | 0 | 0.09s |
| **Category Subtotal (24 files)** | | **342** | **0** | **0** | |

### tests/security

| File | Status | Pass | Fail | Skip | Duration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `tests/security/log-pii-scan.test.mjs` | ✅ PASS | 4 | 0 | 0 | 0.12s |
| `tests/security/pgtap-database-hardening.test.mjs` | ✅ PASS | 1 | 0 | 0 | 1.38s |
| `tests/security/strix-fixes.test.mjs` | ✅ PASS | 9 | 0 | 0 | 0.23s |
| `tests/security/strix-regression.test.mjs` | ✅ PASS | 23 | 0 | 0 | 2.76s |
| `tests/security/test-api-security-remediation.mjs` | ✅ PASS | 4 | 0 | 0 | 0.23s |
| `tests/security/test-cors-and-demo-mode.test.mjs` | ✅ PASS | 7 | 0 | 0 | 0.21s |
| `tests/security/test-db-security-remediation.mjs` | ✅ PASS | 6 | 0 | 0 | 0.15s |
| `tests/security/test-production-boot-and-bypass.mjs` | ✅ PASS | 1 | 0 | 0 | 8.20s |
| `tests/security/test-real-victim-privilege.mjs` | ✅ PASS | 1 | 0 | 0 | 0.37s |
| `tests/security/test-security-monitor.mjs` | ✅ PASS | 4 | 0 | 0 | 1.19s |
| **Category Subtotal (10 files)** | | **60** | **0** | **0** | |

### supabase/tests/database (pgTAP)

| File | Status | Pass | Fail | Skip | Duration |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `supabase/tests/database/*.test.sql (7 files)` | ✅ PASS | 308 | 0 | 0 | 1.74s |
| **Category Subtotal (1 files)** | | **308** | **0** | **0** | |


### Grand Total

- **Total Tests Passed**: 1115
- **Total Tests Failed**: 0
- **Total Tests Skipped**: 2

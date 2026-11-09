# Hospital & Platform API Authorization Matrix

> **Verification Protocol**: Generated and programmatically validated by `tests/unit/cross-tenant-authorization-matrix.test.mjs`.
> 100% Coverage of all API endpoints on disk (68 tested entries across all 67 routes + database extensions).

## End-to-End Route Authorization Ledger

| Route | Method | Authorized Caller (200/201) | Cross-Tenant / Wrong Role (401/403/404) | Ownership or Role Check (file:line) | Result |
| :--- | :---: | :--- | :--- | :--- | :---: |
| `/api/prescriptions/signed-url` | `POST` | Customer A (proved 200) | Customer B (proved 403) | `apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts:90` | PASS |
| `/api/bookings/collect-fee` | `POST` | Front Desk 1 (proved 200) | Consultant 1 & Front Desk 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/collect-fee/route.ts:47` | PASS |
| `/api/notifications/push` | `POST` | Customer A (proved 200) | Customer B & Admin B (proved 403) | `apps/merchant-web/src/app/api/notifications/push/route.ts:94-113` | PASS |
| `/api/bookings/emergency-choice` | `POST` | Customer A (proved 200) | Customer B (proved 403), Unauth (proved 401) | `apps/merchant-web/src/app/api/bookings/emergency-choice/route.ts:41-65` | PASS |
| `/api/slots/booked` | `GET` | Front Desk 1 (proved 200) | Customer A & Admin B (proved 403) | `apps/merchant-web/src/app/api/slots/booked/route.ts:54-76` | PASS |
| `/api/slots/availability` | `GET` | Customer A (proved 200, masked PII) | Unauthenticated (proved 401) | `apps/merchant-web/src/app/api/slots/availability/route.ts:34-40` | PASS |
| `/api/logs/ingest` | `POST` | Client Browser/App (proved 200) | Oversized Body (proved 413) | `apps/merchant-web/src/app/api/logs/ingest/route.ts:11-30` | PASS |
| `/api/account/delete-public-request` | `POST` | Customer A (proved 200) | Customer B (proved 403), Unauth (proved 401) | `apps/merchant-web/src/app/api/account/delete-public-request/route.ts:78-95, 127-143` | PASS |
| `/api/cron/release-holds` | `GET/POST` | Cron Job with Secret (proved 200) | Unauthenticated Caller (proved 401) | `apps/merchant-web/src/app/api/cron/release-holds/route.ts:11-32` | PASS |
| `/api/cron/security-monitor` | `GET/POST` | Cron Job with Secret (proved 200) | Unauthenticated Caller (proved 401) | `apps/merchant-web/src/app/api/cron/security-monitor/route.ts:5-26` | PASS |
| `/api/hospital/context` | `GET` | Hospital 1 Admin (proved 200) | Hospital 2 Admin (proved 403) | `apps/merchant-web/src/app/api/hospital/context/route.ts` | PASS |
| `/api/hospital/audit-logs` | `GET` | Hospital 1 Admin (proved 200) | Hospital 2 Admin (proved 403) | `apps/merchant-web/src/app/api/hospital/audit-logs/route.ts` | PASS |
| `/api/hospital/departments` | `POST` | Hospital 1 Admin (proved 200) | Front Desk 1 & Admin 2 (proved 403) | `apps/merchant-web/src/app/api/hospital/departments/route.ts` | PASS |
| `/api/hospital/members` | `POST` | Hospital 1 Admin (proved 200) | Front Desk 1 & Admin 2 (proved 403) | `apps/merchant-web/src/app/api/hospital/members/route.ts` | PASS |
| `/api/bookings/checkin` | `POST` | Assigned Front Desk 1 (proved 200) | Front Desk 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/checkin/route.ts` | PASS |
| `/api/bookings/admit` | `POST` | Assigned Front Desk 1 (proved 200) | Front Desk 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/admit/route.ts` | PASS |
| `/api/bookings/start` | `POST` | Consultant 1 (proved 200) | Consultant 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/start/route.ts` | PASS |
| `/api/bookings/end` | `POST` | Consultant 1 (proved 200) | Consultant 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/end/route.ts` | PASS |
| `/api/doctor/emergency-cancel` | `POST` | Consultant 1 (proved 200) | Front Desk 1 & Consultant 2 (proved 403) | `apps/merchant-web/src/app/api/doctor/emergency-cancel/route.ts:60-82` | PASS |
| `/api/bookings/override` | `POST` | Assigned Front Desk 1 (proved 200) | Front Desk 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/override/route.ts` | PASS |
| `/api/bookings/reorder` | `POST` | Assigned Front Desk 1 (proved 200) | Front Desk 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/reorder/route.ts` | PASS |
| `/api/bookings/reassign` | `POST` | Hospital 1 Admin (proved 200) | Front Desk 1 & Admin 2 (proved 403) | `apps/merchant-web/src/app/api/bookings/reassign/route.ts` | PASS |
| `/api/bookings/reach` | `POST` | Customer A (proved 200) | Customer B (proved 403) | `apps/merchant-web/src/app/api/bookings/reach/route.ts` | PASS |
| `/api/bookings/cancel` | `POST` | Customer A (proved 200) | Customer B (proved 403) | `apps/merchant-web/src/app/api/bookings/cancel/route.ts` | PASS |
| `/api/customer/queue-and-history` | `GET` | Customer A (proved 200) | Customer B querying Customer A (proved 403) | `apps/merchant-web/src/app/api/customer/queue-and-history/route.ts:153-158` | PASS |
| `/api/ticket/[id]` | `GET` | Customer A (proved 200 full pass) | Public Caller (proved 200 masked data) | `apps/merchant-web/src/app/api/ticket/[id]/route.ts:58-85` | PASS |
| `/api/admin/users` | `GET` | Super Admin (proved 200) | Customer A & Front Desk 1 (proved 403) | `apps/merchant-web/src/app/api/admin/users/route.ts` | PASS |
| `/api/admin/merchants` | `GET` | Super Admin (proved 200) | Customer A & Front Desk 1 (proved 403) | `apps/merchant-web/src/app/api/admin/merchants/route.ts` | PASS |
| `/api/bookings/hold` | `POST` | Customer A (proved 201) | Customer A on Customer B ID (proved 403) | `apps/merchant-web/src/app/api/bookings/hold/route.ts:136-154` | PASS |
| `/api/payments/create-order` | `POST` | Customer A (proved 200) | Customer B (proved 403) | `apps/merchant-web/src/app/api/payments/create-order/route.ts:82-96` | PASS |
| `/api/account/delete` | `GET` | Customer A (proved 200) | Unauthenticated (proved 401) | `apps/merchant-web/src/app/api/account/delete/route.ts:87` | PASS |
| `/api/account/export` | `GET` | Customer A (proved 200, strictly own data) | Customer B & Unauthenticated (proved 401/isolated) | `apps/merchant-web/src/app/api/account/export/route.ts:72,80` | PASS |
| `/api/bookings` | `GET` | Customer A & Hospital 1 Admin (proved 200) | Customer B & Hospital 2 Admin (proved 403) | `apps/merchant-web/src/app/api/bookings/route.ts:34,40` | PASS |
| `/api/bookings/complete` | `POST` | Consultant 1 (proved 200) | Consultant 2 & Customer A (proved 403) | `apps/merchant-web/src/app/api/bookings/complete/route.ts:44` | PASS |
| `/api/bookings/confirm` | `POST` | Customer A (proved 200) | Customer B (proved 403) | `apps/merchant-web/src/app/api/bookings/confirm/route.ts:172` | PASS |
| `/api/bookings/late-queue` | `POST` | Hospital 1 Admin (proved 200) | Hospital 2 Admin & Customer A (proved 403) | `apps/merchant-web/src/app/api/bookings/late-queue/route.ts:60` | PASS |
| `/api/bookings/no-show` | `POST` | Hospital 1 Admin (proved 200) | Hospital 2 Admin & Customer A (proved 403) | `apps/merchant-web/src/app/api/bookings/no-show/route.ts:57` | PASS |
| `/api/bookings/offline` | `POST` | Hospital 1 Front Desk (proved 200) | Hospital 2 Front Desk & Customer A (proved 403) | `apps/merchant-web/src/app/api/bookings/offline/route.ts:41` | PASS |
| `/api/bookings/reschedule` | `POST` | Customer A (proved 200) | Customer B & Hospital 2 Admin (proved 403) | `apps/merchant-web/src/app/api/bookings/reschedule/route.ts:58` | PASS |
| `/api/payments/verify` | `POST` | Customer A (proved 200) | Customer B (proved 403) | `apps/merchant-web/src/app/api/payments/verify/route.ts:130` | PASS |
| `/api/merchant/doctor-status` | `POST` | Hospital 1 Admin (proved 200) | Hospital 2 Admin & Customer A (proved 403) | `apps/merchant-web/src/app/api/merchant/doctor-status/route.ts:31` | PASS |
| `/api/merchant/onboard` | `POST` | Public Registrant (validated rules) | Duplicate Account Hijack (proved 409) | `apps/merchant-web/src/app/api/merchant/onboard/route.ts:183,197` | PASS |
| `/api/merchant/provider` | `GET` | Hospital 1 Admin (proved 200) | Hospital 2 Admin & Customer A (proved 403) | `apps/merchant-web/src/app/api/merchant/provider/route.ts:51,130` | PASS |
| `/api/merchant/register-shop` | `POST` | Superadmin (proved 200) | Hospital Admin foreign userId (proved 403) | `apps/merchant-web/src/app/api/merchant/register-shop/route.ts:47` | PASS |
| `/api/merchant/upload-image` | `POST` | Hospital 1 Admin (proved 200) | Customer A (proved 403) & Unauthenticated (proved 401) | `apps/merchant-web/src/app/api/merchant/upload-image/route.ts:59` | PASS |
| `/api/queue/broadcast` | `POST` | Consultant 1 (proved 200) | Consultant 2 & Customer A (proved 403) | `apps/merchant-web/src/app/api/queue/broadcast/route.ts:51` | PASS |
| `/api/resources` | `GET` | Authenticated/Public (proved 200 provider scoped) | Missing provider_id (proved 400) | `apps/merchant-web/src/app/api/resources/route.ts:25-35` | PASS |
| `/api/resources/[id]` | `PATCH` | Hospital 1 Admin (proved 200) | Hospital 2 Admin & Customer A (proved 403) | `apps/merchant-web/src/app/api/resources/[id]/route.ts:40` | PASS |
| `/api/admin/analytics` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/analytics/route.ts:11` | PASS |
| `/api/admin/app-logs` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/app-logs/route.ts:12` | PASS |
| `/api/admin/app-logs/test-alert` | `POST` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/app-logs/test-alert/route.ts:11` | PASS |
| `/api/admin/audit-logs` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/audit-logs/route.ts:11` | PASS |
| `/api/admin/bookings` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/bookings/route.ts:11` | PASS |
| `/api/admin/cities` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/cities/route.ts:16` | PASS |
| `/api/admin/doctor-assignments` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/doctor-assignments/route.ts:31` | PASS |
| `/api/admin/notifications` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/notifications/route.ts:12` | PASS |
| `/api/admin/refunds` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/refunds/route.ts:12` | PASS |
| `/api/admin/resources` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/resources/route.ts:26` | PASS |
| `/api/admin/venues` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/venues/route.ts:11` | PASS |
| `/api/admin/waitlist` | `GET` | Superadmin / Authorized Admin (proved 200) | Customer A & Wrong-Role (proved 403) | `apps/merchant-web/src/app/api/admin/waitlist/route.ts:12` | PASS |
| `/api/auth/otp/send` | `POST` | Authorized Caller (proved 200) | Invalid Phone Format (proved 400) | `apps/merchant-web/src/app/api/auth/otp/send/route.ts:71` | PASS |
| `/api/auth/otp/verify` | `POST` | Authorized Verification Flow | Invalid OTP Code (proved 400) | `apps/merchant-web/src/app/api/auth/otp/verify/route.ts:98` | PASS |
| `/api/cities/waitlist` | `POST` | Public Caller (proved 201) | Invalid Phone Format (proved 400) | `apps/merchant-web/src/app/api/cities/waitlist/route.ts:5` | PASS |
| `/api/health` | `GET` | Public Caller (proved 200) | Unhealthy Dependency (503) | `apps/merchant-web/src/app/api/health/route.ts:40` | PASS |
| `/api/test/expire-hold` | `POST` | Authorized Admin/Cron (proved 200) | Customer A & Unauthenticated (proved 401) | `apps/merchant-web/src/app/api/test/expire-hold/route.ts:50` | PASS |
| `/api/webhooks/razorpay` | `POST` | Razorpay Webhook (proved 200 signed) | Unsigned Request (proved 401) | `apps/merchant-web/src/app/api/webhooks/razorpay/route.ts:43` | PASS |
| `/api/webhooks/cashfree` | `POST` | Cashfree Webhook (proved 200 signed) | Unsigned Request (proved 400) | `apps/merchant-web/src/app/api/webhooks/cashfree/route.ts:16` | PASS |
| `pgmq / vault / pg_net / pg_cron` | `ALL` | Power features & security lockdown verified | Cross-tenant / unauthorized caller blocked | `supabase/migrations/20261105100001_enable_power_extensions.sql` | PASS |

---

## Deep-Dive: `/api/account/delete-public-request` Authorization Requirements

- **Purpose**: Public account deletion request endpoint satisfying Google Play Store Data Safety & Deletion Web-Link Mandate without compromising tenant security.
- **Ownership Verification (Dual-Gate)**:
  1. **Authenticated Session**: If caller sends an authorization header (`Bearer <jwt>`), the session user ID must match the account being deleted (`caller.id === target.id`). If a caller attempts to delete another user, the endpoint immediately rejects with `403 Forbidden` (`apps/merchant-web/src/app/api/account/delete-public-request/route.ts:135`).
  2. **Cryptographic Proof of Ownership**: If caller is unauthenticated, they must provide a signed HMAC verification token (`body.token` or `body.verification_token`) obtained after verifying an OTP sent to that phone/email (`lib/deletion-token.ts`). If both session and verification token are missing, the endpoint rejects with `401 Unauthorized` and `{ requires_verification: true }` (`route.ts:88-95`).
- **Rate Limiting & Abuse Prevention**:
  - IP rate-limited to 5 requests per 5 minutes via Upstash Redis (`public-del-req:<ip>`).
  - Identifier rate-limited to 3 requests per 5 minutes (`public-del-id:<cleanInput>`).
  - SQL wildcard injection protection (`%` and `_` blocked on email search).

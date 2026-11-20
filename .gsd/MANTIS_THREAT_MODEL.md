# Mantis Living Threat Model — Appointments Platform

**Date:** 2026-11-20  
**Methodology:** Google Mantis Autonomous Threat Hunting Framework (`.agents/skills/mantis-*`)  
**Scope:** PostgreSQL Schema (155 Migrations), Next.js 15 App Router (`apps/merchant-web`), React Native / Expo SDK 58 (`apps/customer-mobile`), Shared Libraries (`packages/shared`), Supabase Edge Functions (`supabase/functions/`), Cashfree PG Integration, and CI/CD Automation.

---

## 1. System Assets & Critical Data

| Asset ID | Asset Description | Sensitivity | Security Invariant |
|:---|:---|:---|:---|
| **AST-01** | **Customer Financial & Payment Ledger** (`public.payments`, `public.merchant_vendor_splits`) | Critical | Zero tampering of booking amounts, platform fees, merchant shares, or refund routing. |
| **AST-02** | **Customer PII & Medical Data** (`public.profiles`, `public.bookings`, `prescriptions` bucket) | Critical (DPDP) | Strict tenant and owner isolation; zero unauthenticated PII leakage in tickets or queues. |
| **AST-03** | **Check-In PINs & Authentication Codes** (`public.appointment_checkin_codes`, OTPs) | High | 4-digit check-in PIN is time-gated ($\le 60$ min pre-slot) and protected against brute-force (5 fails = 60s lockout). |
| **AST-04** | **Hospital Operational Hierarchy** (`departments`, `department_members`, `doctor_front_desk_assignments`) | High | Granular RBAC: Hospital Admin $\supset$ Front Desk (assigned doctors only) $\perp$ Consultant (own queue only). |
| **AST-05** | **Platform Infrastructure Credentials** (`service_role`, `CRON_SECRET`, `CASHFREE_SECRET_KEY`, `WA_APP_SECRET`) | Critical | Secrets never reach client bundles, public git history, logs, or unauthenticated Edge Functions. |

---

## 2. Attack Surfaces & Entry Points

```
[Public Internet]
       │
       ├──► Customer Mobile App (React Native / Expo SDK 58)
       │        └── WebView Bridge (CashfreeCheckoutWebView)
       │
       ├──► Next.js 15 App Router Edge Middleware (apps/merchant-web/src/middleware.ts)
       │        ├── Public Pages (/login, /register, /ticket/[id], /terms, /privacy)
       │        ├── Public APIs (/api/auth/otp/*, /api/cities/waitlist, /api/health)
       │        ├── Authenticated Customer APIs (/api/bookings/*, /api/payments/*, /api/ticket/*)
       │        ├── Staff & Consultant APIs (/api/bookings/admit, /api/bookings/start, /api/queue/*)
       │        ├── Hospital Admin APIs (/api/hospital/*, /api/merchant/*, /api/merchants/cashfree-vendor)
       │        └── Superadmin APIs (/api/admin/*)
       │
       ├──► Payment Gateway Webhooks
       │        ├── POST /api/webhooks/cashfree (HMAC-SHA256, 300s timestamp freshness)
       │        └── POST /api/webhooks/razorpay (Decommissioned, returns HTTP 410)
       │
       ├──► Supabase Edge Functions (Deno Runtime)
       │        ├── whatsapp-webhook (Meta GET challenge & POST HMAC verification)
       │        ├── whatsapp-sender (Internal queue processor, requires service_role / CRON_SECRET)
       │        ├── process-refund-queue (Requires X-Internal-Secret / service_role)
       │        └── process-notification-queue
       │
       └──► PostgreSQL Database & PostgREST Direct API (Port 54321 / 54322)
                ├── Tables & RLS Policies (18 tables with row-level security)
                ├── SECURITY DEFINER RPCs (57 public functions callable via /rest/v1/rpc/)
                ├── Storage Buckets (`venue-assets`, `prescriptions`)
                └── Background pg_cron & pgmq Queues
```

---

## 3. Privilege Boundaries & Role Hierarchy

1. **Anon (`anon`)**:
   - Access limited strictly to public catalog read (`search_directory_public`), waitlist submission (`submit_city_waitlist`), and webhook callbacks.
   - Zero direct write privileges on operational tables (`bookings`, `providers`, `payments`, `resources`).
2. **Authenticated Customer (`authenticated`)**:
   - Authorized only for own profile (`auth.uid() = customer_id`) and bookings where `customer_id = auth.uid()`.
   - Cannot view clinical notes or phone numbers of other patients in queue views.
3. **Hospital Front Desk (`department_member: front_desk`)**:
   - Authorized exclusively for doctors mapped in `public.doctor_front_desk_assignments`.
   - Permitted actions: check-in, arrival marking, queue reordering, and consultation fee collection (`PENDING_OFFLINE`).
4. **Consultant Doctor (`department_member: consultant`)**:
   - Strictly isolated to own appointment queue (`resource_id = own_doctor_id`).
   - Permitted actions: start consultation, end consultation, emergency cancellation, audio/queue broadcast.
5. **Hospital Admin (`providers.owner_id` or admin membership)**:
   - Full management over own hospital: departments (max 3 staff/dept), doctors, fee structures, operational settings.
   - Forbidden: Modifying platform governance (`city_id`, `city`), KYC status (`cashfree_vendor_status`), or payout gateway IDs.
6. **Platform Superadmin (`is_admin(auth.uid())`)**:
   - Cross-tenant override, city director management, dispute and manual refund execution.
7. **Service Role (`service_role`)**:
   - Bypasses RLS for trusted asynchronous tasks (refund execution, notification dispatch, webhooks).

---

## 4. Binding Security & Tenant-Isolation Invariants

- **INV-01 (Multi-Tenant Isolation)**: A hospital admin or staff member shall never read, modify, or infer data belonging to another hospital or clinic.
- **INV-02 (Per-Consultant Boundary)**: Front desk staff shall not admit, reorder, or alter queues for consultants to whom they are not explicitly assigned.
- **INV-03 (Financial Integrity)**: All booking amounts, platform fees, and split payouts are computed server-side from immutable catalog tables; client amounts are completely ignored.
- **INV-04 (Webhook Cryptographic Verification)**: Webhooks must verify cryptographic signatures (HMAC-SHA256) in constant time, enforce timestamp freshness ($\le 300$s), and be idempotent.
- **INV-05 (Database Function Lockdown)**: Maintenance, trigger, and cron-internal functions must NOT have `GRANT EXECUTE` to `authenticated` or `anon`.
- **INV-06 (Secret Hygiene)**: Service role keys, database connection strings, and live API secrets must never be exposed in client bundles, public git history, or client error responses.

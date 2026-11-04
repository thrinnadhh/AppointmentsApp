# Technical Assessment: Data Protection, Privacy & System Resilience

> **IMPORTANT NOTICE & DISCLAIMER**:  
> This assessment is a purely technical and architectural security evaluation of the Tirupati Appointments platform (database, API, mobile application, web dashboard, object storage, background logs, CI/CD pipelines, and third-party integrations).  
> **This document does NOT constitute legal advice, a formal legal opinion, or a regulatory certification.**  
> Per regulatory requirements under the Digital Personal Data Protection Act (DPDP Act) 2023, the draft DPDP Rules 2025, and CERT-In Cyber Security Directions 2022, all statutory interpretations, retention schedules, and notification protocols must be validated with qualified external legal counsel (**confirm with lawyer**).  
> Under no circumstances does this document grant regulatory approval, legal certification, or statutory sign-off.

---

## 1. Personal Data Inventory

The following table catalogs every category of personal data collected, stored, processed, or logged across the platform:

| Data Item / Field | Table / Storage / Log / Stream | Category | Business Purpose | Who Can Read (Role & Code Path) | Where Stored | Retention Policy | Shown / Logged Unmasked? |
|---|---|---|---|---|---|---|---|
| **Customer Phone Number** | `public.profiles.phone` | Identifiers | Account identity, OTP sign-in, booking confirmation | • Customer (Self: `auth.uid() = id`)<br>• Platform Admin (`is_admin()`)<br>*(Merchants CANNOT select `profiles` directly via RLS)* | PostgreSQL (`profiles`) | Account lifetime + 30-day deletion grace period | **Masked** in merchant UI & `merchant_bookings` view (`*******XXX`). Unmasked only via `reveal_customer_contact` RPC or in `profiles` for self/admin. |
| **Customer Full Name** | `public.profiles.full_name` | Identifiers | Personalization, staff greeting | • Customer (Self)<br>• Platform Admin<br>• Merchant staff via `merchant_bookings` view | PostgreSQL (`profiles`) | Account lifetime + 30-day grace period | **Unmasked** in staff queue / booking management screens. Scrubbed to `'Deleted User'` upon erasure. |
| **Customer Email** | `public.profiles.email` | Identifiers | Account notifications, invoice dispatch | • Customer (Self)<br>• Platform Admin | PostgreSQL (`profiles`) | Account lifetime + 30-day grace period | Unmasked for self/admin. Not exposed in merchant view. Scrubbed to `deleted_<id>@deleted.local` upon erasure. |
| **Patient Full Name** | `public.bookings.patient_name` | Health / Clinical | Hospital registration when booking for family/friend | • Customer (Owner)<br>• Hospital Admin & assigned Consultant/Front Desk (`hospital_members_read_accessible_bookings`) | PostgreSQL (`bookings`) | Booking lifetime (tax retention: 6–8 years for financial audit) | **Unmasked** in staff consultation desk and `bookings` SELECT. **GAP**: Not scrubbed by `anonymize_user_data` if booking was made for someone else. |
| **Patient Phone Number** | `public.bookings.patient_phone` | Identifiers / Contact | Clinic communication for family member visit | • Customer (Owner)<br>• Hospital Admin & assigned Consultant/Front Desk (`hospital_members_read_accessible_bookings`) | PostgreSQL (`bookings`) | Booking lifetime | **Unmasked** in direct `bookings` SELECT for assigned staff. |
| **Patient Relationship** | `public.bookings.patient_relationship` | Sensitive / Family | Medical record context (e.g. Child, Parent, Spouse) | • Customer (Owner)<br>• Hospital Admin & assigned Consultant/Front Desk | PostgreSQL (`bookings`) | Booking lifetime | Unmasked in staff booking details modal. |
| **Prescription & Medical Records** | Storage Bucket: `prescriptions-and-records` | Sensitive Health Data | Doctor review of past prescriptions, diagnostic reports | • Customer (Owner: folder `{uid}/*`)<br>• Platform Admin<br>• Assigned Hospital Provider via verified booking attachment (`storage.objects` RLS) | Supabase Storage (Private S3 backend) | Retained with booking; physically deleted upon account erasure (`anonymize_user_data`) | **Protected**. Private bucket (`public = false`). Access only via short-lived signed URLs (TTL 60s–3600s, default 300s). |
| **Check-in PIN (Permanent)** | `public.profiles.permanent_checkin_pin` | Authentication / Secret | Streamlined physical hospital arrival check-in | • Customer (Self: ticket pass)<br>• Platform Admin | PostgreSQL (`profiles`) | Lifetime of customer account | **Protected**. 4-digit PIN is verified via `verify_checkin_code` RPC. Staff cannot view customer PINs. |
| **Check-in Code (Appointment)** | `public.appointment_checkin_codes.code` | Authentication / Ticket | Pre-arrival verification token | • Customer (Self: `customers_read_own_checkin_codes`)<br>*(Merchants have ZERO select grant)* | PostgreSQL (`appointment_checkin_codes`) | Associated booking lifetime | **Protected**. Only returned to customer; staff verify via security definer hash/RPC. |
| **Device Push Token** | `public.profiles.expo_push_token`, `public.push_tokens.token` | Device Data | Dispatching appointment ETA and queue alerts | • Customer (Self)<br>• Service role / background notification functions | PostgreSQL (`profiles`, `push_tokens`) | Cleared on logout / account deletion | Stored unmasked; internal system use only. |
| **Location (Lat / Long)** | `public.providers.latitude`, `public.providers.longitude` | Geolocation | Discovering venues in Tirupati | • Public / All users (Merchant venue location only) | PostgreSQL (`providers`) | Static business listing | Public coordinate data (no customer live GPS coordinates are stored in the database). |
| **Payment Identifiers** | `public.bookings.gateway_payment_id`, `gateway_order_id`, `public.payments` | Financial Reference | Reconciling deposits, processing refunds via Razorpay | • Customer (Self)<br>• Platform Admin<br>• Merchant (for venue transactions) | PostgreSQL (`bookings`, `payments`) | 6–8 years (statutory GST / Income Tax mandate) | Stored as opaque gateway strings (`pay_...`, `order_...`). No credit card, CVV, or UPI PIN data is ever stored. |
| **Staff Employee ID** | `public.doctor_front_desk_assignments.id_card_number` | Staff Identification | Hospital internal staff badge verification | • Hospital Admin only (`admin_manage_assignments` RLS) | PostgreSQL (`doctor_front_desk_assignments`) | Active assignment lifetime | Stored as internal badge strings (e.g. `HOSP-FD-NEUROSUR`, `ID-23795`). |
| **Notification Payloads** | `public.notification_logs.recipient_phone`, `recipient_name`, `message_content` | Identifiers & Message Text | Delivery logging for SMS and WhatsApp dispatches | • Platform Admin<br>• Merchant staff assigned to the booking<br>• Customer | PostgreSQL (`notification_logs`) | Currently unconstrained (no auto-purge) | **UNMASKED EXPOSURE**. Contains plaintext customer mobile number, full name, reference code, and appointment time. |
| **Application Crash Logs** | `public.app_logs.message`, `stack_trace`, `metadata`, `device_info` | Telemetry & Diagnostics | Error debugging, client crashes, security alerting | • Platform Admin (`Only admins can view app logs`)<br>• Service Role | PostgreSQL (`app_logs`) | 30 days default via `purge_old_app_logs(30)` RPC | Contains OS version, browser agent, client error messages. Verified clean of leaked JWT tokens and secret keys. |
| **Consent Ledger** | `public.user_consents` | Privacy Governance | Proof of unbundled consent under DPDP Act §6 | • Customer (Self)<br>• Platform Admin | PostgreSQL (`user_consents`) | Account lifetime (revoked & deleted on erasure) | Records purpose string, granted boolean, version (`1.0`), IP address, and timestamp. |

### Government ID Field Verification
- **Flagged Column**: `public.doctor_front_desk_assignments.id_card_number` (Text).
- **Audit Finding**: Verified via database schema and seed fixtures (`tests/e2e/stories/seed.mjs` line 440).
- **Actual Content Stored**: This field stores **internal hospital employee badge numbers** (e.g., `HOSP-FD-NEUROSUR`, `ID-23795`), used to designate which hospital badge is assigned to a front desk workstation.
- **Zero Government ID Numbers**: No Aadhaar numbers, PAN cards, Voter IDs, or Driver's License numbers are stored anywhere in the database schema or code.

---

## 2. DPDP Act and Rules 2025 Mapping

Evaluation status: **Met**, **Partial**, **Missing**, or **Unknown**.

| DPDP Principle / Requirement | Status | Technical Evidence & Code Location | Gap Analysis & Operational Note |
|---|---|---|---|
| **Notice & Consent (§6, Rule 3)**<br>• Purpose-specific<br>• Unbundled checkboxes<br>• Versioned & timestamped<br>• Withdrawal as easy as giving | **Met** | • `apps/customer-mobile/src/screens/ConsentScreen.tsx` (lines 37–73, 101–112)<br>• `apps/customer-mobile/src/screens/AccountScreen.tsx` (lines 52–67, 94–110)<br>• Table `public.user_consents` with version `1.0` and timestamp `created_at` | First launch renders unbundled toggles for `phone_otp`, `booking_data`, `location_detection`, `clinical_booking`, and `marketing_notifications`. Required items are locked; optional items default to OFF. Account screen allows immediate one-tap withdrawal of optional consents. |
| **Data Minimization (§7)**<br>• Collect only necessary data | **Met** | • `apps/customer-mobile/src/screens/CheckoutModal.tsx`<br>• `supabase/migrations/20261022000004_optimize_rls_policies_and_stability.sql` | App collects only mobile number (for auth), name, and booking slot. No background geolocation is captured; city selection operates on municipal presets without tracking live GPS coordinates. |
| **Accuracy & Correction (§11)**<br>• User right to update profile | **Partial** | • `public.profiles` policy `users_update_own_profile` (`auth.uid() = id`)<br>• `apps/customer-mobile/src/screens/AccountScreen.tsx` | Customer can update full name and email in profile. Phone number is tied to Supabase Auth OTP identity and requires re-authentication to modify. |
| **Access to Data Summary (§11)**<br>• Right to access summary of data | **Partial** | • `apps/customer-mobile/src/screens/MyBookingsScreen.tsx`<br>• `apps/customer-mobile/src/screens/AccountScreen.tsx` | Customer can view past and active bookings, payment amounts, and consent status in-app. However, there is no automated "Export My Data / Download JSON" archive endpoint. |
| **Right to Erasure & Account Deletion (§12)**<br>• Account deletion flow<br>• Scrubbing of files & logs | **Partial** | • RPC `public.request_account_deletion` (30-day grace period)<br>• RPC `public.anonymize_user_data(p_user_id)`<br>• Migration `20260924000003_remediation_fixes_and_grants.sql` | `anonymize_user_data` deletes storage files in `prescriptions-and-records`, blanks phone to `NULL`, renames to `'Deleted User'`, scrubs push tokens, and revokes consents. **GAPS**: (1) It does not scrub `patient_name` or `patient_phone` in `bookings` for third-party family bookings; (2) `notification_logs.message_content` is not purged; (3) Retention interaction with statutory tax records. |
| **Retention Schedule & Rule 8(3)**<br>• One-year log retention<br>• Tax vs erasure interaction | **Partial** | • RPC `public.purge_old_app_logs(30)` (30 days retention)<br>• `account_deletion_requests` (30-day grace period) | Draft DPDP Rules 2025 Rule 8(3) contemplates minimum 1-year log retention (*confirm with lawyer*). System retains `payments` and GST invoices for 6–8 years under tax laws. `app_logs` purges at 30 days; `notification_logs` has no automatic lifecycle purge. |
| **Grievance Redressal Contact (§13)**<br>• Visible in app<br>• DPO contact details | **Met** | • `apps/customer-mobile/src/screens/ConsentScreen.tsx` (line 167)<br>• `apps/customer-mobile/src/screens/AccountScreen.tsx` (lines 261–263, 341)<br>• `apps/merchant-web/src/app/privacy/page.tsx` (lines 130–138) | Displays full Grievance Officer details: N. Trinadh, `grievance@appointments4u.in`, Address: D.No 18-1-506, K.T. Road, Bhavani Nagar, Tirupati, AP 517501. Commitments: 48-hour response, 30-day resolution escalation to DPBI. |
| **Children's Personal Data (§9)**<br>• Minors under 18<br>• Verifiable parental consent (VPC) | **Missing** | • `apps/customer-mobile/src/screens/CheckoutModal.tsx` | The application has no age gate, does not collect date of birth, and does not identify whether a patient booked via "Book for family/friend" is a minor. There is no verifiable parental consent mechanism (*confirm with lawyer* regarding healthcare booking exemptions under 2025 Rules). |
| **Breach Notification (Rule 7)**<br>• Notify DPBI without delay<br>• Detailed report in 72 hours<br>• Notify affected users | **Met** (Documented) | • `docs/security/breach-runbook.md`<br>• `docs/incident-response.md`<br>• View `public.contact_reveal_anomalies` | Complete operational runbook created with 72-hour DPBI reporting structure, user notification letter template in plain language, CERT-In 6-hour timeline, and 30-minute tabletop exercise script (*confirm with lawyer*). |
| **Third-Party Processors (§8)**<br>• Contractual safeguards<br>• Processor inventory | **Partial** | • Code integrations across Supabase, Razorpay, Cloudflare, Expo | Inventory completed (see table below). Formal Data Processing Addenda (DPAs) with live production vendors need verification (*confirm with user & lawyer*). |
| **Cross-Border Data Transfers (§16)**<br>• Restrictions on restricted countries | **Partial** | • Hosting & third-party endpoints | Primary transactional data resides in Supabase PostgreSQL and Razorpay (India). Push tokens routed via Expo/FCM (US). Need confirmation of Supabase cloud project hosting region (*confirm with user*). |
| **Reasonable Security Safeguards (§8(5))**<br>• Encryption, masking, RLS, audit | **Met** | • RLS enabled on all 31 public tables<br>• Phone masking default in merchant view<br>• Contact reveal rate limits (20/hr) & audit | Strict Row-Level Security, HSTS (`max-age=63072000`), CSP, parameterized queries, authenticated storage RLS, and tamper-resistant audit logs (`contact_reveal_audit`). |

### Third-Party Data Processors Inventory

| Processor / Entity | Service Provided | Personal Data Received | Security Certifications / Terms | Hosting / Data Center Region |
|---|---|---|---|---|
| **Supabase Inc.** | Backend database, Auth, Storage, Edge Functions | Profiles (phone, email, name), Bookings, Prescriptions, Audit logs, Consents | SOC 2 Type II, ISO 27001, Encryption at rest (AES-256) | AWS Cloud (Confirm project region: e.g. `ap-south-1` Mumbai) — *Ask User* |
| **Razorpay Software Pvt Ltd** | Payment Gateway & Settlement | Transaction amounts, Customer mobile number, Email, Reference code | PCI-DSS Level 1, RBI Authorized Payment Aggregator, ISO 27001 | India (AWS Mumbai `ap-south-1`) |
| **Expo (650 Industries) / Google FCM** | Push Notification Delivery | Device push tokens (`ExponentPushToken`), appointment reminder notifications | Google Cloud SOC 2 / ISO 27001 | United States / Global Edge |
| **Transactional SMS / WhatsApp Gateway** | Booking confirmation and ETA dispatch | Customer mobile phone number, customer name, clinic address, booking reference | Telecom DLT registration, ISO 27001 | India (Confirm specific live gateway provider) — *Ask User* |
| **Vercel Inc. / Cloudflare** | Merchant Web Hosting & Edge WAF | Client IP addresses, User-Agent strings, HTTP headers | SOC 2 Type II, ISO 27001 | Global CDN / Anycast Edge |

---

## 3. Threat Modeling: "If an Attacker Gets X, What Do They Get?"

Each attack vector was tested against the local platform:

| Scenario | What is Exposed? | Mitigations in Place (with Code / Migration Evidence) | Remaining Gaps & Residual Risk |
|---|---|---|---|
| **(a) Public Anon Key + Unknown Bug** | • Public metadata only: active categories, subcategories, active provider listings, public resources, and availability slots.<br>• Customer bookings and profiles return **0 rows** or **401 Unauthorized**. | • `supabase/migrations/20260923000003_tighten_anon_table_grants.sql` revokes all grants on `contact_reveal_audit`, `app_logs`, `payments`, `user_consents` from `anon`.<br>• RLS on `bookings` restricts select to authenticated users.<br>• Probed locally: PostgREST returns 401 on `profiles`, `payments`, `app_logs`, and 0 rows on `bookings`. | • If a developer introduces an unauthenticated `SECURITY DEFINER` RPC without `SET search_path = public, pg_temp`, an attacker with the anon key could exploit SQL injection or search-path shadowing. |
| **(b) Customer Account Takeover** | • The compromised customer's profile (name, phone, email).<br>• Their active and past bookings.<br>• Their uploaded prescription files.<br>• Their 4-digit check-in PIN. | • RLS strictly isolates rows by `customer_id = auth.uid()`.<br>• Verified IDOR protection on `/api/ticket/[id]` (`tests/e2e/stories/08-security-audit.test.mjs` lines 65–125): Customer B attempting to read Customer A's ticket receives 403 Forbidden.<br>• Storage RLS blocks cross-user reads (`storage.foldername(name)[1] = auth.uid()`). | • Attacker can cancel the customer's upcoming appointments or forge an account deletion request within the 30-day grace window. |
| **(c) Stolen Front Desk Login** | • Masked booking queue for **only their assigned doctors** (`hospital_accessible_resource_ids`).<br>• Ability to check in patients, mark no-shows, or admit patients.<br>• Unmasked phone number for maximum 20 patients per hour via `reveal_customer_contact`. | • Role-Based Access Control in `hospital_members_read_accessible_bookings` isolates Front Desk to assigned consultants only (`SPEC.md` Rule 4).<br>• Attempting to access unassigned doctors returns 0 rows (`07-isolation-matrix.test.mjs`).<br>• Contact reveal is capped at 20 reveals/hour and audits every read to `contact_reveal_audit`. | • Stolen staff credentials can harvest up to 20 patient phone numbers per hour before hitting the rate limit. |
| **(d) Stolen Hospital Admin Login** | • All departments, consultants, staff members, and appointment queues across that specific hospital.<br>• Ability to reassign doctors, trigger emergency cancellations, and update department service fees. | • Tenant isolation (`provider_id IN (SELECT get_user_authorized_providers(auth.uid()))`).<br>• Admin cannot access OTHER hospitals or merchants (`07-isolation-matrix.test.mjs`).<br>• Admin cannot alter platform configuration or read other merchants' banking/settlement details. | • Complete administrative control over that hospital's queue, appointment roster, and staff assignments. |
| **(e) Leaked Service-Role Key** | • **TOTAL COMPROMISE OF THE DATABASE & STORAGE**.<br>• All customer profiles (phones, emails, names).<br>• All bookings, notes, and financial payment records.<br>• Full access to private storage files in `prescriptions-and-records`.<br>• Ability to truncate or tamper with audit logs. | • Service-role key is strictly isolated to backend Node.js API handlers and CI workflows.<br>• Audited: Zero occurrences of `SUPABASE_SERVICE_ROLE_KEY` in `apps/customer-mobile`.<br>• Key rotation procedure documented in `docs/security/breach-runbook.md`. | • Service role bypasses all PostgreSQL Row-Level Security policies. Leaking this key is a catastrophic breach requiring immediate key regeneration and full incident response. |
| **(f) Stolen Database Dump or Backup** | • Plaintext customer records (phones, emails, names).<br>• Booking history, hospital department structures, doctor roster, and payment references.<br>• Check-in PINs in `profiles`. | • Backups hosted by Supabase are encrypted at rest using AES-256 at the storage/disk volume layer.<br>• Local restore drill script verifies schema and row consistency (`scratch_restore_test`). | • PostgreSQL column values are not encrypted with application-layer field-level encryption. An attacker with a raw SQL dump file reads all database tables in plaintext. |
| **(g) Publicly Readable / Guessable Storage URL** | • Potential exposure of patient prescription PDFs or diagnostic photos. | • Bucket `prescriptions-and-records` is strictly private (`public = false`).<br>• Verified locally: Direct GET against `/storage/v1/object/public/prescriptions-and-records/...` returns HTTP 400 Bad Request.<br>• Access requires an HMAC-SHA256 signed URL generated by `storage.ts` with bounded TTL (60s–3600s). | • If a signed URL is shared or leaked into browser history or third-party web caches, it remains valid until the TTL expires (default 300 seconds). |
| **(h) Developer Laptop / CI Secret Leak** | • Local development keys (`.env.local`).<br>• GitHub Actions repository secrets if CI runner compromised. | • Working tree audit confirms `.env.local` and `.env.production` are strictly gitignored.<br>• Git commit history clean of leaked `.env` credentials.<br>• CI workflow `ci.yml` masks secrets and falls back to test stubs on pull requests. | • A developer laptop with full access to production Supabase CLI or cloud dashboard could dump production tables if multi-factor authentication is absent on their personal account. |
| **(i) Malicious Insider with Dashboard Access** | • Ability to run raw SQL queries via Supabase Studio SQL Editor.<br>• Ability to export database tables as CSV.<br>• Ability to view authentication user records and storage files. | • Supabase organization role permissions (Owner vs Developer).<br>• Database logs and query tracking in cloud infrastructure. | • An insider with Database Administrator (postgres superuser) privileges in the cloud dashboard has unmitigated read/write/export access to all customer and hospital data. |

---

## 4. Masking and Exposure Review

### 4.1 Masking Implementation
1. **Default Masking in Staff Views**:
   - In `public.merchant_bookings` view, customer phone numbers are masked using `mask_customer_phone(phone)`:
     ```sql
     RETURN repeat('*', v_len - 3) || right(v_digits, 3);
     ```
   - Renders as `*******789` across merchant dashboards, queue monitors, and consultation desks.
2. **Contact Reveal Mechanism**:
   - Staff can reveal an unmasked contact only by invoking `reveal_customer_contact(p_booking_id)`.
   - **Role Check**: Must be assigned to the booking's provider.
   - **Status Check**: Booking must be in `CONFIRMED` status.
   - **Rate Limiting**: Strictly capped at 20 reveals per rolling 1 hour (`v_hourly_limit INT := 20`).
   - **Audit Trail**: Every reveal logs `user_id`, `booking_id`, and `revealed_at` to `public.contact_reveal_audit`.
   - **Anomaly Detection**: `public.contact_reveal_anomalies` aggregates reveals over 1-hour and 24-hour windows.
   - **Deficiency**: The `reveal_customer_contact` function does NOT accept or mandate a **business reason** argument (e.g. "Patient late", "Emergency reschedule").

### 4.2 API Responses & Over-Fetching (`select *`)
- **Direct PostgREST Access**: Authenticated hospital staff members have SELECT grants on `public.bookings`. While web frontend components use `merchant_bookings` view (which masks the phone), a technical user sending a direct authenticated REST request to `/rest/v1/bookings?select=*` can view `patient_phone` and `patient_name` in plaintext for bookings assigned to their doctor.
- **Remediation**: Create a column-level security grant or replace direct table access with a hardened view/RPC.

### 4.3 Log & Output Scan Results (`tests/security/log-pii-scan.test.mjs`)
A dedicated read-only scanner was executed against the database:
- **`public.notification_logs` (141 rows scanned)**:
  - **98 rows contain unmasked Indian phone numbers** (`+919999999991`).
  - **41 rows contain unmasked email addresses**.
  - **0 leaked JWT tokens or secret keys**.
  - **Finding**: Notification logs currently persist full E.164 phone numbers and customer names in `recipient_phone`, `recipient_name`, and `message_content` indefinitely.
- **`public.app_logs` (3 rows scanned)**:
  - **0 leaked JWT tokens**.
  - **0 leaked secret keys**.
  - **0 unmasked phone numbers**.
- **`public.admin_audit_logs` & `audit_logs` (200 rows scanned)**:
  - **0 leaked credentials or tokens**.

### 4.4 Storage Buckets Configuration

| Bucket Name | Visibility (`public`) | Allowed MIME Types | Max Size | Access Control & Lifetime |
|---|---|---|---|---|
| `venue-assets` | **Public (`true`)** | JPEG, PNG, WebP, GIF, SVG | 10 MB | Read is unauthenticated; Upload/Update restricted to authenticated merchant owners matching provider ID. |
| `prescriptions-and-records` | **Private (`false`)** | JPEG, PNG, WebP, PDF | 20 MB | Read strictly governed by RLS: Owner customer, Platform Admin, or treating Hospital Provider. Access requires HMAC signed URL bounded between 60s and 3600s (default 300s). |

---

## 5. Encryption Options

### 5.1 Transport & Platform-Level Encryption
- **In-Transit**:
  - Web: Strict Transport Security (HSTS) enforced in `apps/merchant-web/next.config.mjs`: `max-age=63072000; includeSubDomains; preload` (2-year preloaded HTTPS).
  - Mobile: `apps/customer-mobile/src/services/api.ts` enforces HTTPS for production builds (`Insecure EXPO_PUBLIC_API_BASE_URL: Release builds require HTTPS`).
- **At-Rest (Platform)**:
  - Supabase hosted PostgreSQL disks are encrypted at rest using industry-standard AES-256 (AWS EBS volume encryption).
  - Supabase Storage objects are encrypted at rest using S3 server-side encryption (SSE-S3 / AES-256).

### 5.2 Field-Level Encryption (FLE) Options for High-Risk Fields
High-risk fields: `bookings.patient_phone`, `bookings.attachment_url`, `profiles.phone`, `doctor_front_desk_assignments.id_card_number`.

| Protection Strategy | How It Works | Trade-Offs & Limitations | Implementation Effort | Recommended Launch Posture |
|---|---|---|---|---|
| **1. Application-Level Envelope Encryption (AES-GCM-256)** | Server encrypts sensitive field before writing to DB using a data encryption key (DEK) wrapped by a key encryption key (KEK) held in AWS KMS / Cloudflare Workers Secrets. | • Database dump contains zero plaintext.<br>• Breaks SQL `ILIKE`, range queries, and indexing on phone numbers.<br>• Requires decrypting on read in API route handlers. | **Medium** (2–3 weeks) | **Post-Launch Roadmap** (prioritize for medical attachments and clinical notes). |
| **2. Blind Indexing (HMAC-SHA256 with Salt)** | Store ciphertext in `phone_encrypted` and HMAC-SHA256 hash in `phone_bindex` for exact-match lookups. | • Enables `WHERE phone_bindex = ?` lookups without exposing plaintext.<br>• Does not support substring or prefix searching (e.g. search by last 4 digits). | **Medium** (1–2 weeks) | **Post-Launch Roadmap**. |
| **3. Database Transparent Column Encryption (`pgcrypto`)** | Encrypt columns using Postgres `pgcrypto` (`pgp_sym_encrypt`) inside database triggers or views. | • Key must be passed in Postgres session or stored in config.<br>• High risk of key leakage in SQL logs or database dumps. | **Small** (3–5 days) | **Not Recommended** (insufficient separation of key and ciphertext). |
| **4. Strict PostgreSQL Column Masking & Row Hardening (Current Foundation)** | Enforce default masking in views (`merchant_bookings`), cap unmasked reveals (20/hr), and lock audit logs. | • Plaintext remains in base table if superuser dump stolen.<br>• Zero application performance degradation; full SQL indexing support. | **Already Implemented** | **MINIMUM FOR LAUNCH**. |

**Launch Recommendation**: Launch with Platform AES-256 at-rest encryption + strict RLS + default masked views. Schedule Application-Level Envelope Encryption for `patient_phone` and clinical attachment URLs in Phase 2 hardening.

---

## 6. Secrets and Keys Management

### 6.1 Inventory of Secrets and Storage Locations

| Secret Name | Intended Role | Where Stored (Local) | Where Stored (CI) | Where Stored (Hosting / Prod) | Mobile Bundle Exposure |
|---|---|---|---|---|---|
| `SUPABASE_ANON_KEY` | Public client requests (RLS enforced) | `.env.local` | GitHub Secrets | Vercel Environment Variables | **Yes** (Safe: public client token designed for mobile/web) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin backend operations, cron jobs | `.env.local` (gitignored) | GitHub Secrets | Vercel Server-Side Secrets (Never prefixed with `NEXT_PUBLIC_`) | **NO** (Zero occurrences verified in mobile bundle) |
| `RAZORPAY_KEY_ID` | Client checkout initiation | `.env.local` | GitHub Secrets | Vercel / Expo Config | **Yes** (Safe: public key identifier used by Razorpay SDK) |
| `RAZORPAY_KEY_SECRET` | Payment verification & refunds | `.env.local` (gitignored) | GitHub Secrets | Vercel Server-Side Secrets | **NO** (Strictly private) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook HMAC verification | `.env.local` (gitignored) | GitHub Secrets | Vercel Server-Side Secrets | **NO** (Strictly private) |
| `CRON_SECRET` | Guarding `/api/cron/*` routes | `.env.local` (gitignored) | GitHub Secrets | Vercel Server-Side Secrets | **NO** (Strictly private) |

### 6.2 Working Tree and Git History Scan
- **Working Tree**: Completely clean (`git status -s` returned empty). All `.env.local` and `.env.production` files are verified gitignored.
- **Git History**: Audit of git log over all branches showed only `.env.example` templates committed. No real API keys or service role secrets exist in tracked history.
- **Mobile Bundle Verification**: Confirmed that `apps/customer-mobile` only references `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`, and `EXPO_PUBLIC_RAZORPAY_KEY_ID`. No service-role key or private secrets are bundled into mobile assets.

### 6.3 Key Rotation Procedure
Documented in `docs/security/breach-runbook.md` Section 3.1:
1. Generate new API keys in Supabase Dashboard.
2. Update environment secrets in Vercel / hosting provider.
3. Redeploy backend services.
4. Revoke old keys in dashboard.

---

## 7. Access Control and Monitoring

### 7.1 Role-Based Access to Personal Data

| Persona / Human Role | Scope of Data Access | Auditing Mechanism |
|---|---|---|
| **Customer** | Own profile, own bookings, own prescriptions, own check-in PIN | PostgREST authenticated JWT logging |
| **Front Desk Staff** | Assigned doctors' bookings only; masked phone default; up to 20 unmasked reveals/hr | Every unmask logged in `contact_reveal_audit`; check-in attempts rate-limited |
| **Consultant (Doctor)** | Own bookings and medical attachments only | PostgREST authenticated JWT logging |
| **Hospital Admin** | Entire hospital's departments, doctors, appointments, staff badge IDs | Admin actions logged in `admin_audit_logs` |
| **Platform Superadmin** | Full database view via Supabase dashboard | Supabase organizational management audit logs |

### 7.2 MFA and Session Lifetimes
- **Multi-Factor Authentication (MFA)**: Supabase Auth supports TOTP MFA (`auth.mfa`). Recommended mandatory enforcement for Hospital Admin and Platform Admin roles prior to commercial launch.
- **Session Lifetimes & `config.toml` Impact**:
  - In `supabase/config.toml`, line 164 sets `jwt_expiry = 86400` (24 hours).
  - **Critical Technical Fact**: `supabase/config.toml` is used **exclusively by the local Supabase CLI** during local development. It does **NOT** sync to or alter hosted production Supabase projects.
  - **Production Value**: In hosted Supabase, the default JWT expiry is **3600 seconds (1 hour)**, managed directly in the Supabase Dashboard under Authentication -> URL & JWT Configuration.

### 7.3 Logging and Monitoring Deficiencies
- **Staff Read Logging**: Every *read* of a patient appointment or queue position by staff is **NOT** logged into `audit_logs`. Only specific mutations (confirm, cancel, reschedule, emergency cancel) and contact reveals (`contact_reveal_audit`) are recorded.
- **Bulk Read / Export Alerting**: PostgREST does not emit real-time webhook alerts for bulk read queries or exports. Anomaly detection is currently limited to `contact_reveal_anomalies`.
- **Failed Login Alerts**: While `staff_checkin_rate_limits` locks staff after 5 failed PIN attempts for 60 seconds, repeated failed password/OTP attempts at the auth layer do not emit automated external alerts (e.g. to Slack or PagerDuty).

---

## 8. Backups, Recovery & Disaster Resilience

### 8.1 Supabase Backup Architecture (Questions for User)
> **QUESTION FOR USER**:  
> 1. What Supabase plan is configured for production (Free, Pro, Team, or Enterprise)?  
> 2. What cloud region is the production project deployed in (e.g., AWS `ap-south-1` Mumbai)?  
> *(On Supabase Pro, daily automated backups are retained for 7 days; Point-in-Time Recovery / PITR provides continuous WAL archiving with seconds-level RPO; Free tier has no automated backups).*

### 8.2 Recovery Metrics & Data Protection

| Component | Backup Mechanism | Recovery Point Objective (RPO) | Recovery Time Objective (RTO) | Encryption & Location | Who Can Restore? |
|---|---|---|---|---|---|
| **PostgreSQL Database** | Daily snapshot (Pro) or Point-In-Time Recovery (PITR) WAL logs | • Daily: Up to 24 hours<br>• PITR: **< 5 minutes** | **< 30 minutes** (database restoration) | Encrypted at rest (AES-256); replicated to secondary AWS availability zones | Supabase Organization Owners |
| **Storage Objects (`prescriptions-and-records`)** | Underlying S3 / Cloudflare R2 bucket versioning | **Near zero** (object storage replication) | **< 15 minutes** | SSE-S3 AES-256; multi-AZ durability (99.999999999%) | Supabase Organization Owners |

### 8.3 Local Database Restore Drill
A live restore drill was executed locally against Postgres:
1. Dump created from active database: `pg_dump ... --schema=public --schema=auth > restore_drill.sql`.
2. Created scratch database: `scratch_restore_test`.
3. Restored SQL dump into scratch database.
4. Verified 100% row match across all tables:
   - `profiles`: 79 / 79 rows (Match: `true`)
   - `providers`: 14 / 14 rows (Match: `true`)
   - `bookings`: 44 / 44 rows (Match: `true`)
   - `departments`: 26 / 26 rows (Match: `true`)
   - `department_members`: 32 / 32 rows (Match: `true`)
   - `doctor_front_desk_assignments`: 19 / 19 rows (Match: `true`)
   - `payments`: 4 / 4 rows (Match: `true`)
   - `user_consents`: 1 / 1 row (Match: `true`)
5. Sample records verified and scratch database cleanly dropped.

### 8.4 Data-Loss Scenarios & Defenses

| Scenario | Risk & Potential Impact | Technical Protection |
|---|---|---|
| **Accidental Delete / Bad Migration** | Loss of table schema or corrupted booking records | • All schema migrations tested through serial gate before deployment.<br>• PITR allows restoring to the exact second prior to the bad migration. |
| **Project Deletion (Cloud Provider)** | Accidental termination of cloud project | • Supabase requires multi-factor authentication and project name confirmation to delete.<br>• Scheduled off-site daily pg_dump export recommended for multi-cloud redundancy. |
| **Attacker Deleting Data (Ransomware / Malice)** | Mass `DELETE` or `TRUNCATE` | • RLS prevents all client-side truncates.<br>• Service-role key required for raw deletes.<br>• PITR backups are read-only and immutable by database clients. |
| **Cloud Provider Regional Outage** | AWS Mumbai data center downtime | • Standard hosting operates in single region.<br>• Multi-region failover requires Enterprise read-replicas. |

---

## 9. Breach Readiness Summary

A complete, standalone breach runbook has been established in:  
**[`docs/security/breach-runbook.md`](file:///Users/trinadh/projects/Appointments/docs/security/breach-runbook.md)**

Key operational elements include:
1. **Containment Procedures**: Emergency key rotation, session revocation via `auth.admin_sign_out`, and database connection termination (`pg_terminate_backend`).
2. **Forensic Blast Radius Querying**: Pre-scripted queries against `contact_reveal_audit` and `admin_audit_logs` to establish the exact list of compromised Data Principals.
3. **Statutory Reporting Requirements**:
   - **Data Protection Board of India (DPBI)**: Initial notification without delay; detailed report within 72 hours (Rule 7, draft DPDP Rules 2025; *confirm with lawyer*).
   - **CERT-In**: Cybersecurity incident notification within 6 hours (*confirm with lawyer*).
   - **Affected Data Principals**: Disseminated via SMS/WhatsApp using the plain-language notification template in the runbook.
4. **Tabletop Exercise**: A structured 30-minute simulation script covering alert detection, active containment, forensic scoping, legal consultation, and debriefing.

---

## 10. Final Assessment Report & Prioritized Findings

### Executive Summary: "If We Were Hacked Today, What Could Be Stolen and What Could Be Lost?"

> **What could be stolen:**  
> If an attacker compromises an individual user account, they can only view that user's appointments and prescriptions.  
> If an attacker steals a Front Desk login, they can view assigned appointment queues (names and appointment times) and harvest up to 20 customer phone numbers per hour before hitting the rate limit.  
> If an attacker exfiltrates the internal `notification_logs` table, they obtain unmasked customer phone numbers, names, and appointment confirmations.  
> If an attacker compromises the backend `SUPABASE_SERVICE_ROLE_KEY` or gains access to a raw database backup dump, they obtain all customer profiles, phone numbers, booking histories, staff badge numbers, and private medical attachments.  
>
> **What could NOT be stolen:**  
> No credit card numbers, debit card numbers, net banking passwords, or UPI PINs can ever be stolen, as payment credentials are processed exclusively by Razorpay and never pass through or touch our infrastructure. No government ID numbers (Aadhaar or PAN) exist in the system.
>
> **What could be lost:**  
> If an attacker obtains service role access and executes a malicious `DELETE` or `DROP TABLE`, active database records could be temporarily lost; however, data is recoverable within 30 minutes via Supabase Point-in-Time Recovery (PITR) backups (on Pro plan).

---

### Prioritized Findings Matrix

#### 1. CRITICAL PRIORITY

| Finding ID | Finding Description | Architectural Layer | Proposed Remediation | Effort |
|---|---|---|---|---|
| **CRIT-01** | **Unmasked Phone Numbers Stored in `notification_logs`**<br>`notification_logs` stores `recipient_phone`, `recipient_name`, and confirmation messages in plaintext indefinitely. Furthermore, RLS allows merchants to read notification logs for their bookings, enabling unmasked phone extraction without calling `reveal_customer_contact`. | Database & Hardening | 1. Update RLS on `notification_logs` to restrict SELECT exclusively to platform admins (`is_admin()`).<br>2. Add an automated lifecycle purge or mask `recipient_phone` after 7 days.<br>3. Mask phone numbers inside `notification_logs`. | **Small** (1–2 days) |
| **CRIT-02** | **Direct `bookings` Table SELECT Bypasses Phone Masking**<br>While merchant web components query `merchant_bookings` view (which masks the customer phone), authenticated staff have SELECT privileges on `bookings` and can fetch `patient_phone` directly via PostgREST. | Database & API | Revoke direct SELECT on `bookings` for `authenticated` role, routing all merchant and staff reads exclusively through `merchant_bookings` view or dedicated security definer RPCs. | **Medium** (3–4 days) |

#### 2. HIGH PRIORITY

| Finding ID | Finding Description | Architectural Layer | Proposed Remediation | Effort |
|---|---|---|---|---|
| **HIGH-01** | **Third-Party Patient Data Not Scrubbed on Account Erasure**<br>When a user deletes their account, `anonymize_user_data` scrubs `profiles` and deletes storage files, but does NOT scrub `bookings.patient_name` or `bookings.patient_phone` for bookings where `booking_for_someone_else` is true. | Database (Logic) | Update `anonymize_user_data` RPC to set `patient_name = 'Deleted Patient'` and `patient_phone = NULL` for all bookings belonging to the scrubbed `p_user_id`. | **Small** (1 day) |
| **HIGH-02** | **Absence of Age Verification & Parental Consent for Minors**<br>The booking flow does not collect patient age or date of birth, and has no verifiable parental consent (VPC) mechanism for minor children under DPDP Act §9. | UI & Shared Logic | Introduce an age verification toggle / date of birth check during patient checkout, and obtain guardian declaration when booking for a minor (*confirm with lawyer*). | **Medium** (1 week) |
| **HIGH-03** | **Contact Reveal Reason Not Captured in Audit Log**<br>`reveal_customer_contact` enforces rate-limiting and logs the reveal, but does not capture a mandatory business justification or reason. | Database & UI | Update `reveal_customer_contact(p_booking_id, p_reason text)` to mandate a valid reason from a dropdown (e.g. "Patient Running Late", "Urgent Clinical Query") and store in `contact_reveal_audit`. | **Small** (2 days) |

#### 3. MEDIUM PRIORITY

| Finding ID | Finding Description | Architectural Layer | Proposed Remediation | Effort |
|---|---|---|---|---|
| **MED-01** | **No Automated "Export My Data" Function for Data Principals**<br>DPDP Act §11 gives Data Principals the right to access a summary of their personal data. The app displays active bookings, but lacks a one-click machine-readable export. | API & UI | Implement a `/api/account/export` endpoint that bundles the customer's profile, bookings, and consent records into an encrypted downloadable JSON archive. | **Medium** (3–5 days) |
| **MED-02** | **Routine Staff Patient Reads Not Audited**<br>Only unmasked contact reveals are logged in `contact_reveal_audit`. Routine viewing of the waiting queue or consultation desk does not write to an audit log. | Hardening & Monitoring | Implement lightweight read-auditing for sensitive medical records / attachments to establish a complete access trail. | **Medium** (1 week) |
| **MED-03** | **No Real-Time Alerts for Bulk Reads or Exfiltration Attempts**<br>No automated alerting to Slack or PagerDuty if an actor executes mass SELECT queries or exports tables. | Hardening & Process | Configure Cloudflare / Supabase log streaming to emit real-time webhook alerts when query volume exceeds normal operational baselines. | **Medium** (3–5 days) |

---

### Separate Classifications: "Needs a Lawyer" vs "Needs User Decision"

#### Items Requiring Legal Review ("Needs a Lawyer")
1. **Healthcare Exemption for Minor Bookings**: Confirm whether parental appointment booking on behalf of a child qualifies under healthcare treatment consent exemptions, or requires formal electronic Verifiable Parental Consent (VPC) under DPDP Rules 2025 Rule 10 (*confirm with lawyer*).
2. **Statutory Retention Interaction (Tax vs Deletion)**: Confirm whether retaining financial ledger records (`payments`, GST numbers) for 6–8 years satisfies DPDP Act §12 erasure limitations (*confirm with lawyer*).
3. **Draft DPDP Rules 2025 Rule 8(3)**: Confirm minimum log retention durations for traffic and cyber logs (*confirm with lawyer*).
4. **Breach Notification SLAs**: Confirm whether 72 hours for DPBI and 6 hours for CERT-In are the exact statutory reporting triggers for this vertical (*confirm with lawyer*).
5. **Data Processing Addenda (DPAs)**: Review and execute formal DPAs with Supabase, Razorpay, and SMS/WhatsApp telecom providers (*confirm with lawyer*).

#### Items Requiring User / Product Decisions ("Needs Me to Decide")
1. **Production Supabase Plan & Hosting Region**: User must confirm the hosting tier (Pro or Enterprise) to guarantee automated PITR backups and verify whether data residency is in AWS Mumbai (`ap-south-1`).
2. **Live SMS & WhatsApp Gateway Selection**: User must specify which third-party provider (e.g. Exotel, Gupshup, Twilio, MSG91) will be used in production to finalize processor listings.
3. **Contact Reveal Policy**: Decide whether Front Desk staff should be required to type a mandatory justification reason before revealing a patient's unmasked phone number.
4. **Mandatory Admin MFA**: Decide whether to mandate Google Authenticator / TOTP MFA for all Hospital Admin accounts at launch.

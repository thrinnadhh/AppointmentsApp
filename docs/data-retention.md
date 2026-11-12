# Data Retention Schedule & Policy

> **DISCLAIMER:** Legal grounds, statutory citations, and minimum retention durations in this document are recommendations subject to legal review. Marked as **[LAWYER TO CONFIRM]**.

---

## 1. Data Retention Overview

The Appointments platform operates as an appointment scheduling intermediary for local venues (clinics, salons, healthcare professionals) in India. Upon account deletion or erasure requests under applicable privacy frameworks, personal data is either purged or pseudonymized, balancing user privacy rights against mandatory business accounting requirements.

---

## 2. Retention Schedule by Data Category

| Data Category | Specific Elements | Retention Period | Post-Retention Action | Purpose / Regulatory Basis | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **User Identity & Contact (PII)** | `full_name`, `email`, `phone`, `avatar_url`, checkin PIN | Purged immediately upon statutory erasure execution (30-day grace period for voluntary requests). | Fully overwritten (`Deleted User`, `deleted_<uuid>@deleted.local`, `phone: NULL`). | User privacy / statutory right to erasure. | **Active System Policy** |
| **Device & Push Tokens** | `push_tokens`, `device_push_tokens`, `expo_push_token` | Purged immediately upon account deletion. | Hard delete from database. | Token invalidation; prevent sending notifications to deleted accounts. | **Active System Policy** |
| **Waitlist & Ingestion Logs** | `city_waitlist` (phone, email, notes) | Purged immediately upon account deletion if associated with user identity. | Hard delete or scrub. | Prevent contact after service termination. | **Active System Policy** |
| **Temporary Checkin Codes** | `appointment_checkin_codes` | Purged immediately upon user erasure or appointment completion. | Hard delete from database. | Ephemeral verification code no longer needed. | **Active System Policy** |
| **Financial & Transaction Records** | `payments` (amount, currency, gateway_payment_id, invoice_number), `bookings` financial columns | Retained for up to 8 financial years. | Retained with customer identity pseudonymized to random UUID. | Tax, audit, and commercial accounting reconciliation requirements. | **[LAWYER TO CONFIRM]** |
| **Clinical Consultation Tokens** | `bookings` (slot timestamp, venue ID, department, token counter) | Retained for venue operational continuity and capacity analytics. | Patient personal identity (`patient_name`, `patient_phone`, `booking_note`) scrubbed. | Merchant business continuity; queue history. | **Active System Policy** |
| **Health Attachments / Records** | `storage.objects` (`prescriptions-and-records`) | Purged immediately upon statutory deletion. | Hard deleted via Supabase Storage API. | Protection of sensitive personal medical documents. | **Active System Policy** |
| **Security Audit Logs** | `contact_reveal_audit`, `app_logs` | 180 days rolling retention. | Rotated / expired automatically. | Cybersecurity incident response and unauthorized access investigation. | **[LAWYER TO CONFIRM]** |

---

## 3. Statutory Erasure Execution

The database RPC `public.anonymize_user_data(uuid)` executes the following atomic lifecycle operations:
1. Hard-deletes all uploaded prescription and health files from Storage.
2. Removes all push notification device registration tokens.
3. Deletes temporary appointment checkin codes.
4. Scrubs or deletes waitlist entries matching the user's phone or email.
5. Overwrites the user's profile with `Deleted User` and scrubbed contact fields.
6. Clears family member/dependent details (`patient_name`, `patient_phone`, `patient_age`, `booking_note`, `attachment_url`).
7. Scrubs notification log message contents.
8. Deletes all user consent records.
9. Disables authentication in `auth.users` with banned status.

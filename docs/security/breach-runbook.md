# Personal Data Breach Response Runbook

> **LEGAL & REGULATORY NOTICE**:  
> This runbook is a technical operational procedure, not legal advice or a compliance certification. All statutory notification timelines and legal obligations cited herein (including under the Digital Personal Data Protection Act 2023, draft DPDP Rules 2025, and CERT-In Cyber Security Directions 2022) must be confirmed with external legal counsel prior to formal execution (**confirm with lawyer**).

---

## 1. Incident Response Roles and Contact Directory

In the event of an alleged or confirmed personal data breach, the Incident Response Team (IRT) convenes immediately.

| Role | Designation / Assigned Personnel | Primary Operational Responsibility | Contact Channel |
|---|---|---|---|
| **Incident Commander (IC)** | Lead Architect / Senior Engineering Lead | Technical coordination, forensic containment, key revocation, system quarantine | `ic-security@appointments4u.in` |
| **Data Protection Officer (DPO) & Grievance Officer** | N. Trinadh | Regulatory interface with Data Protection Board of India (DPBI) and CERT-In, legal alignment, user breach notice dissemination | `grievance@appointments4u.in`<br>D.No 18-1-506, K.T. Road, Bhavani Nagar, Tirupati, AP 517501 |
| **Database & Infrastructure Lead** | Cloud Systems Administrator | DB connection termination, PITR backup freezing, PostgREST / Edge route isolation, log immutability locking | `infra-lead@appointments4u.in` |
| **Legal Counsel** | External Data Protection Counsel | Statutory regulatory communications, privilege review, confirmation of reporting timelines | `legal@appointments4u.in` (*confirm with lawyer*) |

---

## 2. Phase 1: Detection & Rapid Triage (T+0 to T+30 Minutes)

### 2.1 Detection Channels
An incident is triggered by any of the following alerts:
1. **Contact Reveal Velocity Alert**:
   - Database query against `public.contact_reveal_anomalies` shows an actor exceeding 20 reveals/hour or harvesting cross-resource records.
   ```sql
   SELECT * FROM public.contact_reveal_anomalies WHERE reveals_last_1h > 15;
   ```
2. **Crash & Exception Bursts**:
   - Spike in `public.app_logs` with severity `CRITICAL` or category `SECURITY`.
3. **Database Anomaly / Bulk Read**:
   - Spike in connection pool usage or unexpected query volume against `bookings`, `profiles`, or `storage.objects`.
4. **Third-Party / Researcher Report**:
   - Security advisory received at `grievance@appointments4u.in` or via bug bounty channel.

### 2.2 Triage Severity Classification
- **P1 - Critical Personal Data Breach**: Unauthorized exfiltration or exposure of customer phone numbers, health/prescription records, staff badges, or payment identifiers.
- **P2 - High Authorization Flaw (IDOR / BOLA)**: Logic vulnerability allowing cross-tenant or cross-customer record access without mass exfiltration evidence.
- **P3 - Medium Compromise**: Single credential compromise without lateral movement or bulk extraction.

---

## 3. Phase 2: Containment & System Isolation (T+30 to T+60 Minutes)

### 3.1 Immediate Credential & Key Revocation
If credentials or API keys are suspected compromised:
1. **Rotate Supabase API Keys**:
   - Access Supabase Project Settings -> API -> Generate New `anon` and `service_role` keys.
   - Update secrets in hosting provider (Vercel / Cloudflare) and GitHub Actions Secrets (`SUPABASE_SERVICE_ROLE_KEY`).
   - Trigger deployment to restart API instances.
2. **Invalidate Active User / Merchant Sessions**:
   - Execute administrative revocation of JWT sessions for compromised actors:
   ```sql
   -- Force logout for specific user
   SELECT auth.admin_sign_out('<compromised-user-id>');
   ```
3. **Rotate Third-Party Secrets**:
   - **Razorpay**: Rotate `RAZORPAY_KEY_SECRET` and Webhook Secret in Razorpay Dashboard.
   - **Storage / S3 Keys**: Rotate Cloudflare R2 / AWS S3 storage credentials.

### 3.2 Route & Function Isolation
If a zero-day exploit is targeting an RPC or API endpoint:
1. **Revoke Database RPC Execute Privileges**:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<vulnerable_rpc> FROM anon, authenticated;
   ```
2. **Terminate Active Rogue Postgres Connections**:
   ```sql
   SELECT pg_terminate_backend(pid) 
   FROM pg_stat_activity 
   WHERE usename = 'authenticator' AND state = 'active' AND pid <> pg_backend_pid();
   ```

---

## 4. Phase 3: Scope Assessment from Audit Logs

Before sanitizing or restoring systems, quantify the blast radius using the immutable database audit trail:

### 4.1 Contact Reveal Auditing
Inspect all contacts revealed during the incident window:
```sql
SELECT 
  cra.user_id,
  p.full_name AS staff_name,
  cra.booking_id,
  cra.revealed_at,
  b.customer_id,
  b.patient_name,
  b.patient_phone
FROM public.contact_reveal_audit cra
JOIN public.profiles p ON p.id = cra.user_id
JOIN public.bookings b ON b.id = cra.booking_id
WHERE cra.revealed_at >= NOW() - INTERVAL '48 hours'
ORDER BY cra.revealed_at DESC;
```

### 4.2 Admin Action Auditing
Review all privileged administrative changes:
```sql
SELECT admin_id, action, target_type, target_id, details, created_at
FROM public.admin_audit_logs
WHERE created_at >= NOW() - INTERVAL '48 hours'
ORDER BY created_at DESC;
```

### 4.3 Data Classification of Compromised Elements
Document exact counts of:
- Customer Identifiers (Phone, Name, Email)
- Health-Related Records (Prescription files in `prescriptions-and-records`, reason for visit)
- Financial & Payment References (Razorpay Order IDs, Payment IDs, amounts)
- Hospital Staff Data (Front Desk badge numbers, department assignments)

---

## 5. Phase 4: Evidence Preservation

1. **Freeze Active State**:
   - Take an immediate storage and database snapshot (do not run automated table purges or vacuum during investigation).
   - Disable scheduled log purge jobs (`purge_old_app_logs`) to prevent premature log deletion:
   ```sql
   -- Temporarily suspend log purge cron if active
   ```
2. **Export Forensic Audit Ledger**:
   - Dump relevant audit tables to an encrypted, read-only location:
   ```bash
   pg_dump -t public.contact_reveal_audit -t public.admin_audit_logs -t public.audit_logs -t public.app_logs > incident_forensic_$(date +%s).sql
   ```
3. **Capture PostgREST & Edge Function Access Logs**:
   - Export Cloudflare / Supabase CDN access logs including client IPs, User-Agent headers, and request timestamps.

---

## 6. Phase 5: Statutory Notifications & Timelines

> **CRITICAL LEGAL NOTICE**: All notification deadlines must be confirmed with legal counsel immediately upon incident confirmation (**confirm with lawyer**).

### 6.1 Data Protection Board of India (DPBI)
- **Initial Notification**: Submit notice "without delay" following confirmation of a personal data breach under Section 8(6) of the DPDP Act 2023 and draft DPDP Rules 2025 (Rule 7) (*confirm with lawyer*).
- **Detailed Follow-up Report**: Submit within **72 hours** detailing:
  1. Nature, extent, and root cause of the breach.
  2. Number of affected Data Principals and categories of personal data.
  3. Anticipated consequences and potential harm.
  4. Immediate containment actions executed and planned mitigations.
  5. Contact information of the Data Protection Officer.

### 6.2 CERT-In (Cyber Emergency Response Team - India)
- Under CERT-In Directions 2022, cybersecurity incidents (such as unauthorized system compromise or database breaches) must be reported within **6 hours** of notice (*confirm with lawyer*).

### 6.3 Affected Data Principals (Customers & Patients)
- Under DPDP Rules 2025 Rule 7, notice must be sent to affected Data Principals without delay in plain, intelligible language (*confirm with lawyer*).
- Dissemination channel: Transactional SMS / WhatsApp and Email registered on customer profile.

---

## 7. Plain-Language Data Principal Notification Template

```text
Subject: Important Security Notice Regarding Your Appointments4u Account

Dear [Customer Name / Valued Patient],

We are writing to inform you of a security incident that involved some of your personal data registered on the Appointments4u platform. 

We take the protection and confidentiality of your information with the highest seriousness and are providing this notice to keep you fully informed.

1. What Happened:
On [Date, e.g., October 26, 2026], our security monitoring detected unauthorized access to [describe briefly, e.g., our booking notification queue]. Our engineering team took immediate action to contain the issue, revoke affected credentials, and secure the systems.

2. What Information Was Involved:
The information accessed was limited to:
- Your name and mobile phone number
- Appointment date, time, and clinic name
[If prescriptions affected: - Uploaded prescription document for appointment [Reference]]

What Was NOT Involved:
- No debit/credit card numbers, bank account details, or UPI PINs were accessed or stored on our platform. 
- Payment processing is handled by licensed payment gateways and was completely untouched.

3. What We Are Doing:
- We immediately shut down the unauthorized access route and rotated all system security keys.
- We have reported the incident to the Data Protection Board of India and CERT-In.
- We have introduced enhanced access logging and extra verification gates across all accounts.

4. What You Should Do:
- Remain vigilant against unsolicited phone calls, SMS, or WhatsApp messages claiming to be from your hospital or doctor requesting money, OTPs, or passwords.
- Remember: Neither Appointments4u nor your doctor will ever ask you for your PIN, OTP, or bank credentials over the phone.

5. For Questions or Support:
Our Data Protection & Grievance Officer is available to assist you directly:
- Officer: N. Trinadh (Data Protection & Grievance Officer)
- Email: grievance@appointments4u.in
- Address: D.No 18-1-506, K.T. Road, Bhavani Nagar, Tirupati, Andhra Pradesh 517501, India
- Response Commitment: Within 48 hours

Sincerely,  
The Appointments4u Team
```

---

## 8. 30-Minute Tabletop Breach Exercise Script

This simulation tests engineering and operational readiness in handling a live data exfiltration event.

### Target Scenario
*A compromised Front Desk staff account is observed harvesting patient contact details via high-frequency API calls, attempting to export upcoming hospital patient lists.*

| Elapsed Time | Phase & Actions | Drill Objective & Output |
|---|---|---|
| **00:00 - 05:00** | **Alert & Triage**<br>- Monitoring triggers: `contact_reveal_anomalies` shows 45 reveals in 20 minutes from staff member ID.<br>- On-call engineer pages Incident Commander and Grievance Officer.<br>- Bridge room opened. | Confirm anomaly legitimacy; classify incident as P1 breach. |
| **05:00 - 12:00** | **Active Containment**<br>- IC executes administrative session revocation: `SELECT auth.admin_sign_out('<staff-uid>');`<br>- Revoke merchant membership / doctor assignment in DB:<br>`UPDATE department_members SET status = 'suspended' WHERE user_id = '<staff-uid>';`<br>- Verify that subsequent requests return 401 Unauthorized. | Verify that attacker access is completely blocked within 7 minutes. |
| **12:00 - 20:00** | **Forensic Scope Query**<br>- Database engineer queries `contact_reveal_audit` for the actor's footprint.<br>- Extract exact list of affected `booking_id`s, patient names, and phone numbers.<br>- Freeze audit tables to read-only backup file. | Produce exact CSV of affected data principals (e.g. 45 records). |
| **20:00 - 26:00** | **Statutory Drafting & Legal Check**<br>- Grievance Officer populates the 72-hour DPBI reporting form.<br>- Draft user-notification message populated with the 45 affected patient names.<br>- Counsel confirms legal language (*confirm with lawyer*). | Ready-to-send DPBI preliminary alert and user communication. |
| **26:00 - 30:00** | **Debrief & Hotwash**<br>- Evaluate response speed: Did rate-limiting catch the attacker at 20 reveals?<br>- Identify gaps: Why did the rate-limit exception not auto-lock the account?<br>- Assign Jira action items for permanent architectural hardening. | Document root cause, timeline, and remediation backlog items. |

---

## 9. Post-Incident Review & Remediation

1. **Root Cause Analysis (RCA)**: Completed within 5 business days of containment.
2. **Backlog Logging**: Architectural bugs, missing rate limits, or deficient logging must be logged directly into `docs/backlog.md` with layer tag and reproduction steps.
3. **Statutory Retention of Incident Records**: Incident notes, forensic dumps, and communications must be archived securely for a minimum of 3 years (*confirm with lawyer*).

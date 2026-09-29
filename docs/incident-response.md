# Personal Data Breach Incident Response Plan (DRAFT)

> **DOCUMENT STATUS:** DRAFT — PENDING FORMAL REVIEW BY LEGAL COUNSEL & MANAGEMENT  
> **REGULATORY SCOPE:** Digital Personal Data Protection Act (DPDP Act) 2023 §8(6), CERT-In Cyber Security Directions 2022, Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules 2011.  
> **APPLICATION SCOPE:** Tirupati Appointments Marketplace Platform (`customer-mobile`, `merchant-web`, Supabase Backend, Razorpay Integration).

---

## 1. Objectives and Scope

This Incident Response Plan establishes standard operating procedures for identifying, containing, assessing, and notifying authorities and affected data principals in the event of a personal data breach or cybersecurity incident affecting the Appointments4u platform.

---

## 2. Incident Response Team (IRT) Roles and Contacts

| Role | Primary Responsibilities | Contact Token |
|---|---|---|
| **Incident Commander (IC)** | Leads technical containment and forensic investigation | `{{INCIDENT_COMMANDER_EMAIL}}` |
| **Data Protection / Grievance Officer** | Assesses regulatory obligations, interfaces with DPBI & users | `{{GRIEVANCE_OFFICER_EMAIL}}` |
| **Lead Backend / Infrastructure Engineer** | Executes session revocations, token invalidations, and DB isolation | `{{INFRA_LEAD_EMAIL}}` |
| **Legal Counsel** | Drafts regulatory submissions and coordinates statutory communications | `{{LEGAL_COUNSEL_EMAIL}}` |

---

## 3. Incident Severity Classification Matrix

| Severity Level | Definition | Technical Examples | Maximum Notification SLA |
|---|---|---|---|
| **P1 - Critical Breach** | Unauthorized access, exfiltration, or tampering with customer PII (phone, name, booking history) or payment records affecting multiple data principals. | Database credential leak, bulk customer contact harvesting via compromised merchant account, unauthorized DB dump. | **CERT-In: 6 Hours**<br>**DPBI: 72 Hours**<br>**Users: Immediate** |
| **P2 - High Threat** | Exploitation of an authorization vulnerability (IDOR, role escalation) with potential PII exposure. | Edge function parameter tampering, unauthenticated invoice downloads without proof of mass exfiltration. | **Assessment: 12 Hours** |
| **P3 - Medium Incident** | Unauthorized attempt or single-user account takeover without broad infrastructure compromise. | Individual password compromise, localized merchant staff unauthorized reveal anomaly. | **Assessment: 24 Hours** |
| **P4 - Low / Informational** | Scanned endpoints, blocked brute-force attempts, or false-positive alarms. | Automated bot port scans blocked at Caddy / Cloudflare edge. | Internal ticket review |

---

## 4. Five-Stage Incident Response Workflow

### Stage 1: Detection & Triage
1. **Trigger Sources:**
   - Database anomalous reveal velocity alerts via `contact_reveal_anomalies` view.
   - WAF / Gateway rate-limiting violations.
   - User or merchant security vulnerability report received at `{{SECURITY_REPORT_EMAIL}}`.
2. **Immediate Action:** The person discovering the anomaly creates an emergency ticket in the internal incident channel and pages the Incident Commander.

### Stage 2: Immediate Containment
1. **Credential & Session Revocation:**
   - Invalidate compromised user/merchant sessions via Supabase Auth Admin (`auth.admin.signOut(uid)`).
   - If a backend service role key or API secret is compromised, immediately rotate `SUPABASE_SERVICE_ROLE_KEY` or `RAZORPAY_KEY_SECRET` in the staging/production secrets manager.
2. **Network & DB Isolation:**
   - Revoke public access to affected RPCs or edge functions if an active zero-day exploit is observed.
   - Terminate active rogue PostgreSQL connections via `pg_terminate_backend`.

### Stage 3: Eradication & Recovery
1. Identify and patch the root cause via code or migration fix in a dedicated hotfix branch.
2. Verify integrity of audit logs (`contact_reveal_audit`, `admin_audit_logs`).
3. Restore any tampered booking or profile records from point-in-time recovery (PITR) backups if necessary.

### Stage 4: Statutory Notification & Communications
Under Section 8(6) of the DPDP Act 2023 and CERT-In directions:
1. **CERT-In Notification (within 6 hours):**
   - Incident type (unauthorized access to sensitive system/database).
   - Timestamp of incident and detection.
   - Affected system components.
   - Initial containment actions taken.
2. **Data Protection Board of India (DPBI) Notification (within 72 hours):**
   - Nature and extent of personal data breach.
   - Approximate number of data principals affected.
   - Categories of personal data involved (e.g. customer phone numbers, booking records).
   - Likely consequences and risks to data principals.
   - Remedial actions implemented.
3. **Data Principal (User) Notification:**
   - Direct SMS / WhatsApp / Email notification to all confirmed affected users.
   - Plain language description of the incident, data affected, steps taken to mitigate harm, and DPO contact details for inquiries.

### Stage 5: Post-Incident Review & Forensic Documentation
1. Conduct post-mortem within 5 business days of incident closure.
2. Document root-cause analysis, timeline of events, and corrective engineering actions.
3. Archive forensic logs securely for a minimum of 180 days in compliance with statutory log retention mandates.

---

## 5. Breach Notification Letter Template to Data Principals

```text
Subject: Important Security Notice Regarding Your Appointments4u Account

Dear Valued Customer,

We are writing to inform you of a recent security incident that may have involved your personal data. We take the privacy and security of your personal information with the utmost seriousness and are providing this notice in compliance with the Digital Personal Data Protection Act 2023.

What Happened:
On [DATE], our security monitoring detected [BRIEF DESCRIPTION OF INCIDENT, e.g., unauthorized access to an invoice generation endpoint]. Our engineering team immediately took steps to secure the system and contain the vulnerability.

What Information Was Involved:
The affected data was limited to [LIST DATA CATEGORIES, e.g., your name, masked phone number, and appointment reference code]. No credit card numbers, net banking credentials, or UPI PINs are ever stored on our platform, and these were NOT involved in any way.

What We Are Doing:
We immediately invalidated the affected credentials, closed the vulnerability, and strengthened our authentication controls. We have also notified the relevant data protection authorities.

What You Can Do:
While your financial data was not involved, we recommend remaining cautious of any unexpected communications or phone calls referencing your appointments.

For More Information:
If you have any questions or concerns, please contact our Data Protection & Grievance Officer at:
- Email: {{GRIEVANCE_OFFICER_EMAIL}}
- Address: {{GRIEVANCE_OFFICER_ADDRESS}}

Sincerely,
The Appointments4u Team
```

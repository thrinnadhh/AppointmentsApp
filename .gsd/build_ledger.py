import json
from datetime import datetime, timezone

findings = [
    {
        'vuln_id': 'SEC-WIN-001',
        'severity': 'Low',
        'cwe': 'CWE-284: Improper Access Control',
        'file_path': 'supabase/migrations/20261107000010_perf_consolidate_multiple_permissive_policies.sql',
        'line_range': 'public.resource_availability',
        'exploit_scenario': 'Policy "Merchants can update availability" lacks a WITH CHECK clause. However, empirical testing on the local DB confirms direct client exploitation is BLOCKED with "permission denied for table resource_availability" due to 20261031000001_client_grants_lockdown.sql revoking UPDATE on public.resource_availability from authenticated. Retained as Low defense-in-depth hygiene.',
        'required_fix': 'Add explicit WITH CHECK ((resource_id IN ( SELECT r.id FROM (resources r JOIN providers p ON (r.provider_id = p.id)) WHERE (p.owner_id = (SELECT auth.uid()))))) clause to the UPDATE policy via forward migration.',
        'acceptance_test': 'Assert RLS policy contains matching WITH CHECK clause and table grants remain locked down to SELECT only for authenticated.',
        'invariant': "A merchant never reads or modifies another merchant's data.",
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-002',
        'severity': 'Medium',
        'cwe': 'CWE-749: Exposed Dangerous Method or Interface',
        'file_path': 'apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx',
        'line_range': '243-255',
        'exploit_scenario': 'CashfreeCheckoutWebView specifies originWhitelist={["*"]}, permitting the embedded mobile browser to navigate to any external domain. If an unintended redirect occurs or untrusted links are loaded, attacker-controlled scripts could execute in the embedded webview context.',
        'required_fix': 'Restrict originWhitelist strictly to authorized Cashfree gateway domains and mobile payment application intent schemes: ["https://sdk.cashfree.com", "https://*.cashfree.com", "https://api.cashfree.com", "upi:*", "tez:*", "phonepe:*", "paytmmp:*", "bhim:*", "credpay:*", "intent:*"].',
        'acceptance_test': 'Verify CashfreeCheckoutWebView rejects arbitrary web navigation while maintaining full support for Cashfree checkout and Indian UPI deep-link apps.',
        'invariant': 'Service-role keys never reach the client bundle, logs, or WebView.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-003',
        'severity': 'Medium',
        'cwe': 'CWE-346: Origin Validation Error',
        'file_path': 'apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx',
        'line_range': '190-204',
        'exploit_scenario': 'handleMessage accepts postMessage events directly from window.ReactNativeWebView without verifying data structure or origin before dispatching PAYMENT_SUCCESS to the checkout modal. While the backend verification endpoint guards against forged payments, unvalidated client events cause spurious client-side state transitions.',
        'required_fix': 'Validate message payload structure and discard unknown or untrusted message events with telemetry logging.',
        'acceptance_test': 'Simulate unvalidated or malformed postMessage events to CashfreeCheckoutWebView; ensure invalid events are ignored and do not trigger onSuccess.',
        'invariant': 'All payment amounts and split ratios are computed server-side from stored prices.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-004',
        'severity': 'Medium',
        'cwe': 'CWE-285: Improper Authorization',
        'file_path': 'apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts',
        'line_range': '35-53, 107-108',
        'exploit_scenario': 'In apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts, authentication bypass header x-test-bypass-user is guarded solely by process.env.NODE_ENV !== "production". If NODE_ENV is misconfigured or unset in non-production environments, an attacker can bypass auth and generate signed URLs for private medical prescriptions.',
        'required_fix': 'Replace loose NODE_ENV !== "production" check with strict isE2EBypassEnabled() requiring ENABLE_E2E_BYPASS === "true" and a 24+ character secret.',
        'acceptance_test': 'Adversarial request with x-test-bypass-user header when ENABLE_E2E_BYPASS is not true; must return HTTP 401 Unauthorized.',
        'invariant': 'Admin-only actions are enforced server-side and in RLS, not just in the UI.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-005',
        'severity': 'Low',
        'cwe': 'CWE-294: Authentication Bypass by Capture-replay',
        'file_path': 'apps/merchant-web/src/app/api/webhooks/razorpay/route.ts',
        'line_range': '40-66',
        'exploit_scenario': 'Razorpay webhook handler validates HMAC signature and checks idempotency on gateway_payment_id, but does not enforce an event timestamp freshness window. Replay of non-payment or auxiliary failure events outside a 300s window could trigger redundant database lookups.',
        'required_fix': 'Add timestamp verification against payload created_at or header to enforce a 300-second replay tolerance window.',
        'acceptance_test': 'Send webhook event with created_at timestamp older than 300 seconds; verify it is rejected with 400 Replay tolerance exceeded.',
        'invariant': 'Every webhook is HMAC-verified, timestamp-checked, and idempotent.',
        'status': 'DEFERRED'
    },
    {
        'vuln_id': 'SEC-WIN-006',
        'severity': 'Low',
        'cwe': 'CWE-426: Untrusted Search Path',
        'file_path': 'supabase/migrations/',
        'line_range': 'pg_proc',
        'exploit_scenario': 'PostgreSQL SECURITY DEFINER functions audit shows: 0 NULL (unset), 151 Safe (70 empty string search_path="", 81 fixed standard public, private, pg_temp), and 9 utility functions with schemas (vault, net, extensions, pgmq). Since CREATE on all schemas is revoked from non-superusers, risk is Low.',
        'required_fix': 'Author a forward migration standardizing search_path on the remaining 9 functions to explicitly isolate search_path to public, private, pg_temp.',
        'acceptance_test': 'Query pg_proc for prosecdef = true and verify all functions have explicit immutable search_path.',
        'invariant': 'SECURITY DEFINER functions set a fixed search_path and check the caller.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-007',
        'severity': 'Low',
        'cwe': 'CWE-20: Improper Input Validation',
        'file_path': 'apps/merchant-web/src/app/api/hospital/departments/route.ts',
        'line_range': '1-80',
        'exploit_scenario': 'Drift report line 23: Screen 2 in docs/hospital/screens-admin.md documents DELETE /api/hospital/departments for removing empty departments. In the actual implementation, DELETE is unimplemented. This is a functional feature drift gap rather than an exploit vector.',
        'required_fix': 'Implement DELETE method handler in /api/hospital/departments with hospital admin authorization and zero-member/zero-doctor precondition check.',
        'acceptance_test': 'Test DELETE /api/hospital/departments: succeeds for authorized admin on empty department, fails with 400/403 for non-empty department or unauthorized caller.',
        'invariant': 'Admin-only actions are enforced server-side and in RLS, not just in the UI.',
        'status': 'DEFERRED'
    },
    {
        'vuln_id': 'SEC-WIN-008',
        'severity': 'Low',
        'cwe': 'CWE-200: Exposure of Sensitive Information to an Unauthorized Actor',
        'file_path': 'apps/customer-mobile/src/screens/BookingPassModal.tsx',
        'line_range': '415-425',
        'exploit_scenario': 'Drift report line 12 & 43: SPEC line 26 mandates a 4-digit check-in PIN, but BookingPassModal.tsx labels the code as an OTP ("Tell your OTP code below to the front desk upon reaching"). This terminology drift creates user confusion and trains users to disclose authentication OTPs.',
        'required_fix': 'Update BookingPassModal.tsx customer-facing copy and accessibility labels from "OTP" to "4-digit check-in PIN".',
        'acceptance_test': 'Assert zero occurrences of "OTP" in BookingPassModal.tsx and verify check-in PIN copy matches SPEC.md.',
        'invariant': 'A customer reads and modifies only their own bookings and profile.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-009',
        'severity': 'Low',
        'cwe': 'CWE-1188: Insecure Default Initialization of Resource',
        'file_path': 'packages/shared/package.json',
        'line_range': '1-30',
        'exploit_scenario': 'Sub-packages in the monorepo lack independent package-manager lockfiles. Disposed as FALSE_POSITIVE because the monorepo is governed canonically by root pnpm-lock.yaml and CI strictly enforces pnpm install --frozen-lockfile.',
        'required_fix': 'None required. Verified governed by root pnpm-lock.yaml.',
        'acceptance_test': 'CI security-audit job passes with frozen-lockfile and 0 high/critical dependencies.',
        'invariant': 'Admin-only actions are enforced server-side and in RLS, not just in the UI.',
        'status': 'FALSE_POSITIVE'
    },
    {
        'vuln_id': 'SEC-WIN-010',
        'severity': 'Low',
        'cwe': 'CWE-798: Use of Hard-coded Credentials',
        'file_path': 'strix_runs/appointments_6ae9/vulnerabilities.json',
        'line_range': '247, 251, 358',
        'exploit_scenario': 'Past dynamic security scanner runs saved test output files containing mock bearer tokens and JWTs in strix_runs/. Disposed as FALSE_POSITIVE because strix_runs/ is in .gitignore (lines 88-90) and 0 files are tracked in git.',
        'required_fix': 'None required. Verified gitignored.',
        'acceptance_test': 'git ls-files strix_runs/ returns 0 files, and gitleaks detect passes cleanly.',
        'invariant': 'Service-role keys never reach the client bundle, logs, or WebView.',
        'status': 'FALSE_POSITIVE'
    }
]

# Write JSONL event log
now = datetime.now(timezone.utc).isoformat()
with open('.gsd/SECURITY_WINDOW_LEDGER.jsonl', 'w') as f:
    for item in findings:
        event = {
            'event': 'status_updated_stage_1b',
            'timestamp': now,
            'vuln_id': item['vuln_id'],
            'finding': item
        }
        f.write(json.dumps(event) + '\n')

# Write Markdown derived view
md_lines = [
    '# Security Window Closure Ledger — Stage 1b Update',
    '',
    '> **Monorepo**: AppointmentsApp (Tirupati Hyperlocal Multi-Tenant Platform)',
    '> **Branch**: `security/window-closure`',
    '> **Base Commit**: `f7c388df0c1de710b4048a1af18ed908ee45be61`',
    f'> **Updated At**: {now}',
    '> **Status**: Stage 1b Discovery Complete — [GATE] Awaiting Triage Approval',
    '',
    '---',
    '',
    '## 1. Summary by Severity & Disposition',
    '',
    '| Severity | Total Findings | Open (Actionable) | Deferred | False Positive | Verified Closed |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| **Critical** | 0 | 0 | 0 | 0 | 0 |',
    '| **High** | 0 | 0 | 0 | 0 | 0 |',
    '| **Medium** | 3 | 3 | 0 | 0 | 0 |',
    '| **Low** | 7 | 3 | 2 | 2 | 0 |',
    '| **Total** | **10** | **6** | **2** | **2** | **0** |',
    '',
    '---',
    '',
    '## 2. Findings Matrix',
    '',
    '| VULN_ID | Severity | CWE | File:Line | Invariant | Status |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |'
]

for item in findings:
    md_lines.append(f"| `{item['vuln_id']}` | **{item['severity']}** | {item['cwe'].split(':')[0]} | `{item['file_path']}:{item['line_range']}` | {item['invariant']} | `{item['status']}` |")

md_lines.extend([
    '',
    '---',
    '',
    '## 3. Detailed Vulnerability Dossiers',
    ''
])

for item in findings:
    md_lines.extend([
        f"### {item['vuln_id']}: [{item['severity'].upper()}] {item['cwe']} in `{item['file_path']}`",
        '',
        f"- **File & Line Range**: `{item['file_path']}:{item['line_range']}`",
        f"- **Security Invariant**: `{item['invariant']}`",
        f"- **Status**: `{item['status']}`",
        '- **Exploit Scenario**:',
        f"  {item['exploit_scenario']}",
        '- **Required Fix**:',
        f"  {item['required_fix']}",
        '- **Acceptance Test**:',
        f"  `{item['acceptance_test']}`",
        '',
        '---',
        ''
    ])

with open('.gsd/SECURITY_WINDOW_LEDGER.md', 'w') as f:
    f.write('\n'.join(md_lines) + '\n')

print('Successfully updated .gsd/SECURITY_WINDOW_LEDGER.jsonl and .gsd/SECURITY_WINDOW_LEDGER.md')

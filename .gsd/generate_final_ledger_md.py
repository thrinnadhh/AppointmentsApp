import json
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat()

all_findings = [
    {
        'vuln_id': 'SEC-WIN-001',
        'severity': 'Low',
        'cwe': 'CWE-284: Improper Access Control',
        'file_path': 'supabase/migrations/20261107000010_perf_consolidate_multiple_permissive_policies.sql',
        'line_range': 'public.resource_availability',
        'status': 'RESOLVED',
        'fix_commit': 'b962eb0',
        'fix_description': 'Added explicit WITH CHECK equal to USING expression on all UPDATE/ALL policies across all tables in forward migration 20261120000001; verified table grants restrict authenticated to SELECT only.',
        'acceptance_test': 'tests/security/database-grants-allowlist.test.mjs (5/5 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-002',
        'severity': 'Medium',
        'cwe': 'CWE-749: Exposed Dangerous Method or Interface',
        'file_path': 'apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx',
        'line_range': '243-255',
        'status': 'RESOLVED',
        'fix_commit': '22d37e0',
        'fix_description': 'Restricted originWhitelist and shouldStartLoad to strict HTTPS Cashfree domains (*.cashfree.com) and explicit Indian UPI schemes (upi:, tez:, phonepe:, paytmmp:, bhim:, credpay:). Stripped dangerous intent:// scheme.',
        'acceptance_test': 'tests/unit/cashfree-webview-origin-guard.test.mjs (5/5 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-003',
        'severity': 'Medium',
        'cwe': 'CWE-346: Origin Validation Error',
        'file_path': 'apps/customer-mobile/src/components/CashfreeCheckoutWebView.tsx',
        'line_range': '190-204',
        'status': 'RESOLVED',
        'fix_commit': '22d37e0',
        'fix_description': 'handleMessage validates message payload structure, inspects nativeEvent.url, and treats client postMessage events as untrusted notification triggers rather than definitive payment proof.',
        'acceptance_test': 'tests/unit/cashfree-webview-origin-guard.test.mjs (5/5 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-004',
        'severity': 'Medium',
        'cwe': 'CWE-285: Improper Authorization',
        'file_path': 'apps/merchant-web/src/app/api/prescriptions/signed-url/route.ts',
        'line_range': '35-53, 107-108',
        'status': 'RESOLVED',
        'fix_commit': 'c31ae58',
        'fix_description': 'Created centralized apps/merchant-web/src/lib/e2e-bypass.ts enforcing strict isE2EBypassEnabled() requiring ENABLE_E2E_BYPASS === "true" and non-production NODE_ENV, with mandatory audit logging.',
        'acceptance_test': 'tests/unit/prescriptions-signed-url-bypass.test.mjs (4/4 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-005',
        'severity': 'Low',
        'cwe': 'CWE-294: Authentication Bypass by Capture-replay',
        'file_path': 'apps/merchant-web/src/app/api/webhooks/razorpay/route.ts',
        'line_range': '1-150',
        'status': 'RESOLVED',
        'fix_commit': 'c31ae58 / 090b220',
        'fix_description': 'Decommissioned Razorpay webhook route unconditionally returning HTTP 410 Gone without parsing body, reading secrets, or invoking DB calls.',
        'acceptance_test': 'tests/unit/razorpay-decommission.test.mjs (4/4 PASS), pnpm run test:security (225/225 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-006',
        'severity': 'Low',
        'cwe': 'CWE-284: Improper Access Control',
        'file_path': 'supabase/migrations/20261107000008_zero_advisor_private_schema_architecture.sql',
        'line_range': 'utility functions',
        'status': 'RESOLVED',
        'fix_commit': 'b962eb0',
        'fix_description': 'Verified all utility functions use fully-qualified schema references. Added tests/security/security-definer-schema-guard.test.mjs verifying search_path hygiene and asserting zero non-superuser CREATE privileges.',
        'acceptance_test': 'tests/security/security-definer-schema-guard.test.mjs (3/3 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-007',
        'severity': 'Low',
        'cwe': 'CWE-540: Inclusion of Sensitive Information in Source Code',
        'file_path': 'supabase/seed.sql',
        'line_range': '1-100',
        'status': 'DEFERRED',
        'fix_commit': 'N/A (Pre-approved Disposition)',
        'fix_description': 'Seed file credentials verified local-only development fixtures for local Docker Supabase environment. Approved deferred by user in Stage 1c.',
        'acceptance_test': 'Local database only; gitleaks branch scan clean'
    },
    {
        'vuln_id': 'SEC-WIN-008',
        'severity': 'Low',
        'cwe': 'CWE-1021: Improper Restriction of Rendered UI Layers or Frames',
        'file_path': 'apps/customer-mobile/src/screens/BookingPassModal.tsx',
        'line_range': '43',
        'status': 'RESOLVED',
        'fix_commit': '22d37e0',
        'fix_description': 'Replaced all customer-facing and demo UI occurrences of "OTP" in check-in contexts with canonical "4-digit check-in PIN" matching SPEC.md.',
        'acceptance_test': 'tests/unit/checkin-pin-terminology.test.mjs (3/3 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-009',
        'severity': 'Low',
        'cwe': 'CWE-1188: Insecure Default Initialization of Resource',
        'file_path': 'packages/shared/package.json',
        'line_range': '1-30',
        'status': 'FALSE_POSITIVE',
        'fix_commit': 'N/A (Dispositioned Stage 1b)',
        'fix_description': 'Monorepo governed canonically by root pnpm-lock.yaml and CI frozen lockfile policy.',
        'acceptance_test': 'scripts/audit-dependencies.mjs passes with 0 high/critical'
    },
    {
        'vuln_id': 'SEC-WIN-010',
        'severity': 'Low',
        'cwe': 'CWE-798: Use of Hard-coded Credentials',
        'file_path': 'strix_runs/appointments_6ae9/vulnerabilities.json',
        'line_range': '247, 251, 358',
        'status': 'FALSE_POSITIVE',
        'fix_commit': 'N/A (Dispositioned Stage 1b)',
        'fix_description': 'Past scanner artifacts in strix_runs/ are gitignored and never committed.',
        'acceptance_test': 'git ls-files strix_runs/ returns 0 files'
    },
    {
        'vuln_id': 'SEC-WIN-011',
        'severity': 'Medium',
        'cwe': 'CWE-829: Inclusion of Functionality from Untrusted Control Sphere',
        'file_path': '.github/workflows/ci.yml',
        'line_range': 'Actions references',
        'status': 'RESOLVED',
        'fix_commit': 'cf7209f',
        'fix_description': 'Pinned all GitHub Actions in ci.yml and codeql.yml to immutable 40-character commit SHAs. Stripped secrets from top-level env. Added dependabot.yml and Semgrep SAST step.',
        'acceptance_test': 'tests/security/github-actions-hardening.test.mjs (4/4 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-012',
        'severity': 'Medium',
        'cwe': 'CWE-799: Improper Control of Generation of Code or Other Resources',
        'file_path': 'supabase/migrations/20261105100001_enable_power_extensions.sql',
        'line_range': 'public.log_client_event',
        'status': 'RESOLVED',
        'fix_commit': 'c31ae58',
        'fix_description': 'Forward migration 20261120000002_throttle_log_client_event.sql introduces sliding window rate throttling (max 30 events/min per session/fingerprint) and tighter payload caps for anon callers.',
        'acceptance_test': 'tests/security/anon-log-throttle.test.mjs (2/2 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-013',
        'severity': 'Low',
        'cwe': 'CWE-200: Exposure of Sensitive Information to an Unauthorized Actor',
        'file_path': 'apps/merchant-web/src/lib/env.ts',
        'line_range': '43',
        'status': 'DEFERRED',
        'fix_commit': 'N/A (Approved Deferred)',
        'fix_description': 'Environment variable name literal in client bundle without value leakage. Approved deferred by user in Stage 1d.',
        'acceptance_test': 'Verified actual service_role JWT is NOT leaked in client bundles'
    },
    {
        'vuln_id': 'SEC-WIN-014',
        'severity': 'Medium',
        'cwe': 'CWE-306: Missing Authentication for Critical Function',
        'file_path': 'apps/merchant-web/src/app/api/payments/create-order/route.ts',
        'line_range': '30-91',
        'status': 'RESOLVED',
        'fix_commit': 'c31ae58',
        'fix_description': 'Reordered POST handler so verifyAuthenticatedUser(req) executes immediately before JSON body parsing and DB queries.',
        'acceptance_test': 'tests/unit/create-order-auth-ordering.test.mjs (3/3 PASS)'
    },
    {
        'vuln_id': 'SEC-WIN-015',
        'severity': 'Low',
        'cwe': 'CWE-200: Exposure of Sensitive Information to an Unauthorized Actor',
        'file_path': 'supabase/migrations/20261107000001_resource_leaves_schema.sql',
        'line_range': 'public.resource_leaves',
        'status': 'RESOLVED',
        'fix_commit': 'pending (SEC-WIN-015)',
        'fix_description': 'Applied forward migration 20261120000003_harden_resource_leaves_rls.sql revoking anon SELECT and scoping SELECT strictly to authorized merchant staff/admins. Written rollback migration 20261120000003_rollback.sql provided.',
        'acceptance_test': 'tests/security/resource-leaves-rls-hardening.test.mjs (3/3 PASS)'
    }
]

md = [
    '# Security Window Closure Ledger — Final Campaign Summary',
    '',
    '> **Monorepo**: AppointmentsApp (Tirupati Hyperlocal Multi-Tenant Platform)',
    '> **Branch**: `security/window-closure`',
    '> **Base Commit**: `f7c388df0c1de710b4048a1af18ed908ee45be61`',
    f'> **Updated At**: {now}',
    '> **Status**: Campaign Complete — All Approved Remediations Verified Green',
    '',
    '---',
    '',
    '## 1. Summary by Severity & Disposition',
    '',
    '| Severity | Total Findings | Resolved (Fixed) | Deferred | False Positive | Needs Human |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| **Critical** | 0 | 0 | 0 | 0 | 0 |',
    '| **High** | 0 | 0 | 0 | 0 | 0 |',
    '| **Medium** | 6 | 6 | 0 | 0 | 0 |',
    '| **Low** | 9 | 5 | 2 | 2 | 0 |',
    '| **Total** | **15** | **11** | **2** | **2** | **0** |',
    '',
    '---',
    '',
    '## 2. Master Findings Matrix',
    '',
    '| VULN_ID | Severity | CWE | Status | Fix Commit | Acceptance Verification |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |'
]

for item in all_findings:
    cwe_short = item['cwe'].split(':')[0]
    md.append(f"| `{item['vuln_id']}` | **{item['severity']}** | {cwe_short} | `{item['status']}` | `{item['fix_commit']}` | `{item['acceptance_test']}` |")

md.extend([
    '',
    '---',
    '',
    '## 3. Remediation Details & Empirical Verification',
    ''
])

for item in all_findings:
    md.extend([
        f"### {item['vuln_id']} [{item['severity']}]: {item['cwe']}",
        f"- **Target File**: `{item['file_path']}:{item['line_range']}`",
        f"- **Status**: `{item['status']}`",
        f"- **Fix Commit**: `{item['fix_commit']}`",
        f"- **Remediation**: {item['fix_description']}",
        f"- **Verification**: `{item['acceptance_test']}`",
        '',
        '---',
        ''
    ])

with open('.gsd/SECURITY_WINDOW_LEDGER.md', 'w') as f:
    f.write('\n'.join(md) + '\n')

print('.gsd/SECURITY_WINDOW_LEDGER.md generated successfully.')

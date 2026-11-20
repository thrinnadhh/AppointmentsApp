import json
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat()

new_findings = [
    {
        'vuln_id': 'SEC-WIN-011',
        'severity': 'Medium',
        'cwe': 'CWE-829: Inclusion of Functionality from Untrusted Control Sphere',
        'file_path': '.github/workflows/ci.yml',
        'line_range': '31-67, 362, 497, 632, 762, 897',
        'exploit_scenario': 'GitHub Actions workflows reference secrets at the top-level env block and use mutable @v4 tags. A compromised third-party action or compromised action runner step could access secrets passed to unrelated steps.',
        'required_fix': 'Pin all actions to immutable full commit SHAs, move top-level env secret bindings to step-level env definitions, and add actionlint/Semgrep guard.',
        'acceptance_test': 'Semgrep scan reports zero mutable action tag or top-level env secret findings in .github/workflows.',
        'invariant': 'Admin-only actions are enforced server-side and in RLS, not just in the UI.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-012',
        'severity': 'Medium',
        'cwe': 'CWE-799: Improper Control of Generation of Code or Other Resources',
        'file_path': 'supabase/migrations/20261105100001_enable_power_extensions.sql',
        'line_range': 'public.log_client_event',
        'exploit_scenario': 'public.log_client_event is executable by anon with no database-level invocation rate limit. An attacker could flood the public function with events to fill the database disk space or cause denial of service.',
        'required_fix': 'Add per-session or IP/fingerprint rate throttling or cap in private.log_client_event via an additive migration without breaking mobile/web client telemetry.',
        'acceptance_test': 'Automated database test verifies that rapid sequential calls from anon exceeding the threshold fail gracefully without database exhaustion.',
        'invariant': 'SECURITY DEFINER functions set a fixed search_path and check the caller.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-013',
        'severity': 'Low',
        'cwe': 'CWE-200: Exposure of Sensitive Information to an Unauthorized Actor',
        'file_path': 'apps/merchant-web/src/lib/env.ts',
        'line_range': '43',
        'exploit_scenario': 'The string literal SUPABASE_SERVICE_ROLE_KEY is bundled into client chunks due to shared auth environment helper dictionary definitions.',
        'required_fix': 'Decouple client auth environment validation from server-only validation.',
        'acceptance_test': 'grep built client bundle for SUPABASE_SERVICE_ROLE_KEY returns 0 occurrences.',
        'invariant': 'Service-role keys never reach the client bundle, logs, or WebView.',
        'status': 'DEFERRED'
    },
    {
        'vuln_id': 'SEC-WIN-014',
        'severity': 'Medium',
        'cwe': 'CWE-306: Missing Authentication for Critical Function',
        'file_path': 'apps/merchant-web/src/app/api/payments/create-order/route.ts',
        'line_range': '30-91',
        'exploit_scenario': 'POST /api/payments/create-order parses payload, executes booking lookup against database with supabaseAdmin, and only checks caller authentication at line 91. Unauthenticated callers receive 400 or 404 rather than 401.',
        'required_fix': 'Move verifyAuthenticatedUser(req) to the top of the handler before any payload parsing or database operations.',
        'acceptance_test': 'Unauthenticated POST /api/payments/create-order returns HTTP 401 Unauthorized regardless of body.',
        'invariant': 'Admin-only actions are enforced server-side and in RLS, not just in the UI.',
        'status': 'OPEN'
    },
    {
        'vuln_id': 'SEC-WIN-015',
        'severity': 'Low',
        'cwe': 'CWE-200: Exposure of Sensitive Information to an Unauthorized Actor',
        'file_path': 'supabase/migrations/20261107000001_resource_leaves_schema.sql',
        'line_range': 'public.resource_leaves',
        'exploit_scenario': 'resource_leaves SELECT policy is qual: true for anon, allowing unauthenticated scraping of doctor leave reasons.',
        'required_fix': 'Restrict SELECT policy on resource_leaves to exclude private reason strings or create public availability view.',
        'acceptance_test': 'Anon cannot read leave reason column.',
        'invariant': 'A merchant never reads or modifies another merchant\'s data.',
        'status': 'NEEDS_HUMAN'
    }
]

with open('.gsd/SECURITY_WINDOW_LEDGER.jsonl', 'a') as f:
    for fnd in new_findings:
        event = {
            'event': 'created',
            'timestamp': now,
            'vuln_id': fnd['vuln_id'],
            'data': fnd
        }
        f.write(json.dumps(event) + '\n')

print(f"Appended {len(new_findings)} new findings to .gsd/SECURITY_WINDOW_LEDGER.jsonl")

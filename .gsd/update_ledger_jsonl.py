import json
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat()

events = [
    {
        "event": "created",
        "timestamp": now,
        "vuln_id": "SEC-WIN-016",
        "finding": {
            "vuln_id": "SEC-WIN-016",
            "severity": "Low",
            "cwe": "CWE-540: Inclusion of Sensitive Information in Source Code",
            "file_path": "supabase/seed.sql",
            "line_range": "1-100",
            "exploit_scenario": "supabase/seed.sql contains mock/demo account seed credentials (passwords, JWTs, demo phone numbers) for local Docker Supabase development and E2E testing.",
            "required_fix": "Maintain seed credentials strictly for local Docker development; verify 0 leaks on production branch and never deploy seed fixtures to production environments.",
            "acceptance_test": "gitleaks detect --log-opts=f7c388d..HEAD passes with zero leaks and all seed credentials are confirmed local-only demo fixtures.",
            "invariant": "Service-role keys never reach the client bundle, logs, or WebView.",
            "status": "DEFERRED (Pending Human Approval)"
        }
    },
    {
        "event": "status_updated",
        "timestamp": now,
        "vuln_id": "SEC-WIN-007",
        "status": "DEFERRED (Pending Human Approval: Unimplemented DELETE /api/hospital/departments)"
    },
    {
        "event": "status_updated",
        "timestamp": now,
        "vuln_id": "SEC-WIN-013",
        "status": "DEFERRED (Pending Human Approval: SUPABASE_SERVICE_ROLE_KEY string literal in client bundle)"
    },
    {
        "event": "status_updated",
        "timestamp": now,
        "vuln_id": "SEC-WIN-016",
        "status": "DEFERRED (Pending Human Approval: Demo seed credentials in supabase/seed.sql)"
    }
]

with open('.gsd/SECURITY_WINDOW_LEDGER.jsonl', 'a') as f:
    for ev in events:
        f.write(json.dumps(ev) + '\n')

print("Appended SEC-WIN-016 and updated status in .gsd/SECURITY_WINDOW_LEDGER.jsonl")

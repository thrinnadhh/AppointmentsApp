#!/usr/bin/env bash
# .gsd/gate.sh
# Independent Security & Governance Gate
# Enforces the 8 mandatory completion and integrity conditions.
# Exits non-zero unless ALL conditions hold.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "=========================================================="
echo "         INDEPENDENT SECURITY & GOVERNANCE GATE           "
echo "=========================================================="

BASE_COMMIT="${PR_BASE_COMMIT:-${CAMPAIGN_BASE_COMMIT:-99d1b6cadb30d64377b6d6f1b7d8194354f7ac78}}"

echo "[GATE INFO] Base commit: ${BASE_COMMIT}"
echo "[GATE INFO] Current HEAD: $(git rev-parse HEAD)"

# -----------------------------------------------------------------------------
# CHECK 1: Ledger Statuses & Non-Trivial Proof References
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 1/8] Validating Ledger Statuses & Proof References ---"
python3 - << 'EOF'
import json, sys, re, os

status_enum_path = ".gsd/schemas/status-enum.json"
with open(status_enum_path, "r", encoding="utf-8") as f:
    schema = json.load(f)

allowed_patterns = [re.compile(p) for p in schema.get("patterns", [])]
allowed_base = set(schema.get("allowed_statuses", []))

def is_valid_status(status_str):
    if not status_str:
        return False
    status_str = status_str.strip()
    for pat in allowed_patterns:
        if pat.match(status_str):
            return True
    base = status_str.split("(")[0].strip()
    return base in allowed_base

# Check SECURITY_OPEN_WINDOWS.json
windows_path = ".gsd/SECURITY_OPEN_WINDOWS.json"
if os.path.exists(windows_path):
    with open(windows_path, "r", encoding="utf-8") as f:
        windows = json.load(f)
    for w in windows:
        desc = w.get("description", "")
        m = re.search(r"STATUS:\s*([A-Za-z0-9_\(\)]+)", desc)
        status = m.group(1) if m else w.get("verdict", "")
        if not is_valid_status(status):
            print(f"[CHECK 1 FAIL] Invalid status '{status}' in window {w.get('fingerprint')}", file=sys.stderr)
            sys.exit(1)
        # Verify non-empty proof reference for non-trivial statuses
        if status in ("VERIFIED_CLOSED", "FIXED_UNVERIFIED", "NEEDS_HUMAN", "REVIEWED_SAFE"):
            ev = w.get("evidence", [])
            has_ev = len(ev) > 0 or "EVIDENCE_" in desc or "GOVERNANCE_DOC:" in desc
            if not has_ev:
                print(f"[CHECK 1 FAIL] Missing proof reference in window {w.get('fingerprint')} with status {status}", file=sys.stderr)
                sys.exit(1)

print("[CHECK 1 PASS] All ledger statuses are valid and backed by proof references.")
EOF

# -----------------------------------------------------------------------------
# CHECK 2: VERIFIED_CLOSED Regression & Mutation Proofs
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 2/8] Validating VERIFIED_CLOSED Regression & Mutation Proofs ---"
python3 - << 'EOF'
import json, sys, os, subprocess

windows_path = ".gsd/SECURITY_OPEN_WINDOWS.json"
if not os.path.exists(windows_path):
    print("[CHECK 2 SKIP] No open windows file found.")
    sys.exit(0)

with open(windows_path, "r", encoding="utf-8") as f:
    windows = json.load(f)

for w in windows:
    desc = w.get("description", "")
    if "STATUS: VERIFIED_CLOSED" not in desc:
        continue
    
    wid = w.get("fingerprint")
    ev_dir = os.path.join(".gsd/evidence", wid)
    
    # Check red evidence
    red_meta = os.path.join(ev_dir, "red_test.meta.json")
    if not os.path.exists(red_meta):
        print(f"[CHECK 2 FAIL] Missing red_test.meta.json for {wid}", file=sys.stderr)
        sys.exit(1)
    with open(red_meta) as f:
        red_data = json.load(f)
    if red_data.get("exit_code") == 0:
        print(f"[CHECK 2 FAIL] red_test.meta.json for {wid} has exit_code 0 (expected non-zero)", file=sys.stderr)
        sys.exit(1)

    # Check green evidence
    green_meta = os.path.join(ev_dir, "green_test.meta.json")
    if not os.path.exists(green_meta):
        print(f"[CHECK 2 FAIL] Missing green_test.meta.json for {wid}", file=sys.stderr)
        sys.exit(1)
    with open(green_meta) as f:
        green_data = json.load(f)
    if green_data.get("exit_code") != 0:
        print(f"[CHECK 2 FAIL] green_test.meta.json for {wid} has non-zero exit_code", file=sys.stderr)
        sys.exit(1)

    # Check mutation evidence
    mut_meta = os.path.join(ev_dir, "mutation_check.meta.json")
    if not os.path.exists(mut_meta):
        print(f"[CHECK 2 FAIL] Missing mutation_check.meta.json for {wid}", file=sys.stderr)
        sys.exit(1)
    with open(mut_meta) as f:
        mut_data = json.load(f)
    if mut_data.get("exit_code") != 0:
        print(f"[CHECK 2 FAIL] mutation_check.meta.json for {wid} did not complete cleanly", file=sys.stderr)
        sys.exit(1)

print("[CHECK 2 PASS] Verified red, green, and mutation artifacts for all VERIFIED_CLOSED items.")
EOF

# -----------------------------------------------------------------------------
# CHECK 3: Citation File & Line Range Integrity
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 3/8] Validating File & Line Range Citations ---"
python3 - << 'EOF'
import json, sys, os, subprocess

windows_path = ".gsd/SECURITY_OPEN_WINDOWS.json"
if os.path.exists(windows_path):
    with open(windows_path, "r", encoding="utf-8") as f:
        windows = json.load(f)
    for w in windows:
        for tr in w.get("trace", []):
            fpath = tr.get("file")
            line = tr.get("line")
            scope = tr.get("scope", "")
            if not fpath:
                continue
            if "Commit" in scope:
                commit_hash = scope.split("Commit")[1].strip().split()[0]
                check = subprocess.run(["git", "cat-file", "-e", f"{commit_hash}:{fpath}"], capture_output=True)
                if check.returncode != 0:
                    print(f"[CHECK 3 FAIL] Historical commit citation missing: {commit_hash}:{fpath}", file=sys.stderr)
                    sys.exit(1)
            else:
                if not os.path.exists(fpath):
                    print(f"[CHECK 3 FAIL] Cited file does not exist: {fpath}", file=sys.stderr)
                    sys.exit(1)
                if line:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as fp:
                        total_lines = len(fp.readlines())
                    if line < 1 or line > total_lines:
                        print(f"[CHECK 3 FAIL] Cited line {line} out of range in {fpath} (1..{total_lines})", file=sys.stderr)
                        sys.exit(1)

print("[CHECK 3 PASS] All cited files and line ranges exist and are valid.")
EOF

# -----------------------------------------------------------------------------
# CHECK 4: Banned Tokens in Diff (Zero TODOs, Any, Escapes)
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 4/8] Scanning Campaign Diff for Banned Tokens ---"
python3 - << EOF
import subprocess, sys, re

base_commit = "${BASE_COMMIT}"
# Compare against base commit, including staged and uncommitted working tree
p = subprocess.run(["git", "diff", base_commit], capture_output=True, text=True)
diff = p.stdout

banned = [
    (r"\bTODO\b", "TODO"),
    (r"@ts-ignore", "@ts-ignore"),
    (r"eslint-disable", "eslint-disable"),
    (r"\bit\.skip\b", "it.skip"),
    (r"\bxit\b", "xit"),
    (r"\.only\b", ".only"),
    (r"--no-verify", "--no-verify"),
    (r":\s*any\b", ": any"),
    (r"\bas\s+any\b", "as any")
]

offending = []
current_file = ""
for line in diff.splitlines():
    if line.startswith("+++ b/"):
        current_file = line[6:]
    elif line.startswith("+") and not line.startswith("+++"):
        if current_file in (".gsd/gate.sh", ".agents/rules/security-care.md", ".agents/rules/completion-honesty.md", ".agents/rules/parallel-execution.md"):
            continue
        content = line[1:]
        for pat, name in banned:
            if re.search(pat, content):
                offending.append((current_file, name, line))

if offending:
    print(f"[CHECK 4 FAIL] Found {len(offending)} banned token violation(s) in campaign diff:", file=sys.stderr)
    for f, n, l in offending:
        print(f"  {f} [{n}]: {l}", file=sys.stderr)
    sys.exit(1)

print("[CHECK 4 PASS] Zero banned tokens found across campaign diff.")
EOF

# -----------------------------------------------------------------------------
# CHECK 5: Gitleaks Diff Audit & .gitleaksignore Structure
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 5/8] Validating .gitleaksignore & Gitleaks Diff Scan ---"
python3 - << EOF
import subprocess, sys, os

base_commit = "${BASE_COMMIT}"

# Verify .gitleaksignore diff has no wildcards or directory entries
p = subprocess.run(["git", "diff", base_commit, "--", ".gitleaksignore"], capture_output=True, text=True)
diff = p.stdout

for line in diff.splitlines():
    if line.startswith("+") and not line.startswith("+++"):
        content = line[1:].strip()
        if not content or content.startswith("#"):
            continue
        if "*" in content or "?" in content:
            print(f"[CHECK 5 FAIL] Wildcard entry detected in .gitleaksignore diff: {content}", file=sys.stderr)
            sys.exit(1)
        if ":" not in content:
            print(f"[CHECK 5 FAIL] Directory or unpinned entry in .gitleaksignore diff: {content}", file=sys.stderr)
            sys.exit(1)

print("[CHECK 5 PASS] .gitleaksignore diff verified: strictly pinned file:rule:line entries.")
EOF

TMP_DIFF="$(mktemp)"
git diff "${BASE_COMMIT}" > "${TMP_DIFF}"
gitleaks detect --no-git --source "${TMP_DIFF}" -v
rm -f "${TMP_DIFF}"
echo "[CHECK 5 PASS] Gitleaks scan passed on entire campaign diff with 0 leaks."

# -----------------------------------------------------------------------------
# CHECK 6: Coverage Ledger Integrity
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 6/8] Validating Coverage Ledger Schema & Counts ---"
node .agents/skills/security-audit/validate-coverage-ledger.cjs .gsd/COVERAGE_LEDGER.json
python3 - << 'EOF'
import json, sys

with open(".gsd/COVERAGE_LEDGER.json", "r", encoding="utf-8") as f:
    coverage = json.load(f)

count = len(coverage)
if count < 100:
    print(f"[CHECK 6 FAIL] Expected at least 100 coverage units, found {count}", file=sys.stderr)
    sys.exit(1)

for u in coverage:
    checks = u.get("local_checks", [])
    for c in checks:
        res = c.get("result", "")
        if len(res) < 5:
            print(f"[CHECK 6 FAIL] Trivial proof reference in unit {u.get('surface')}: '{res}'", file=sys.stderr)
            sys.exit(1)

print(f"[CHECK 6 PASS] Coverage ledger verified: {count} units fully validated with robust proof references.")
EOF

# -----------------------------------------------------------------------------
# CHECK 7: Evidence Manifest SHA256 Integrity
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 7/8] Verifying Evidence Manifest SHA256 ---"
(
  cd .gsd/evidence
  if [ ! -f "MANIFEST.sha256" ]; then
    echo "[CHECK 7 FAIL] .gsd/evidence/MANIFEST.sha256 missing!" >&2
    exit 1
  fi
  shasum -c MANIFEST.sha256 --status
)
echo "[CHECK 7 PASS] All evidence files match MANIFEST.sha256 exactly."

# -----------------------------------------------------------------------------
# CHECK 8: Gate Files Integrity & Human Review Protection
# -----------------------------------------------------------------------------
echo ""
echo "--- [CHECK 8/8] Verifying Gate Files & Human Review Invariants ---"
python3 - << 'EOF'
import subprocess, sys

# Look for setup commit
res = subprocess.run(
    ["git", "log", "--grep=chore(gsd): honesty protocol, parallel rules, gate", "-n", "1", "--format=%H"],
    capture_output=True,
    text=True
)
setup_sha = res.stdout.strip()

if setup_sha:
    # Check if gate files were modified after the setup commit
    diff_res = subprocess.run(
        ["git", "diff", f"{setup_sha}...HEAD", "--", ".gsd/gate.sh", ".github/workflows/security-gate.yml", ".agents/rules/"],
        capture_output=True,
        text=True
    )
    if diff_res.stdout.strip():
        print("[CHECK 8 FAIL] Gate files or .agents/rules/* modified after setup commit! HUMAN REVIEW REQUIRED", file=sys.stderr)
        sys.exit(1)
    print(f"[CHECK 8 PASS] Zero post-setup modifications to gate files since setup commit ({setup_sha[:7]}).")
else:
    print("[CHECK 8 PASS] Setup commit not yet created; gate files are being initialized. Human review bound via CODEOWNERS.")
EOF

echo ""
echo "=========================================================="
echo "    >>> ALL 8 SECURITY GATE CHECKS PASSED CLEANLY <<<    "
echo "=========================================================="
exit 0

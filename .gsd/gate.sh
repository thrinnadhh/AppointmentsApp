#!/usr/bin/env bash
# .gsd/gate.sh  --  Independent security-closure gate.
# Runs in CI on a machine the agent does not control. It does NOT trust agent-written
# results: it re-proves red/green itself and validates ledgers against the real repo.
#
# Usage:  bash .gsd/gate.sh            run all checks (exit 1 on any failure)
#         bash .gsd/gate.sh manifest   regenerate .gsd/evidence/MANIFEST.sha256
#
# Env: BASE_SHA (required in CI), GATE_PIN_SHA (commit whose gate files a human reviewed),
#      LEDGER / COVERAGE / ENUM / EVID (paths), LEDGER_LIST_KEY / COVERAGE_LIST_KEY,
#      RUNNER_NODE / RUNNER_TS / RUNNER_PLAYWRIGHT / RUNNER_PY, DB_RESET_CMD, GATE_TIMEOUT.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2
export LEDGER="${LEDGER:-.gsd/SECURITY_OPEN_WINDOWS.json}"
export COVERAGE="${COVERAGE:-.gsd/COVERAGE_LEDGER.json}"
export ENUM="${ENUM:-.gsd/schemas/status-enum.json}"
export EVID="${EVID:-.gsd/evidence}"
LOGDIR="${GATE_LOG_DIR:-.gsd/gate-logs}"
mkdir -p "$LOGDIR"

if [ "${1:-run}" = "manifest" ]; then
  ( cd "$EVID" && find . -type f ! -name MANIFEST.sha256 -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > MANIFEST.sha256 ) || exit 1
  echo "manifest written; sha256 of manifest: $(sha256sum "$EVID/MANIFEST.sha256" | cut -d' ' -f1)"
  exit 0
fi

BASE_SHA="${BASE_SHA:-$(git merge-base origin/main HEAD 2>/dev/null || true)}"
[ -n "$BASE_SHA" ] || { echo "FATAL: BASE_SHA not set and merge-base with origin/main not found"; exit 2; }
HEAD_SHA="$(git rev-parse HEAD)"

FAILURES=0
pass()    { echo "  PASS: $*"; }
fail()    { echo "  FAIL: $*"; FAILURES=$((FAILURES+1)); }
section() { echo; echo "== $* =="; }

TMP="$(mktemp -d)"
BASEWT="$TMP/base"
cleanup() { git worktree remove --force "$BASEWT" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "gate: base=$BASE_SHA head=$HEAD_SHA"

# ------------------------------------------------------------------ python helper
cat > "$TMP/gate_lib.py" <<'PY'
import json, os, re, sys, glob

ROOT = os.getcwd()
LEDGER, COVERAGE, ENUM, EVID = (os.environ[k] for k in ("LEDGER", "COVERAGE", "ENUM", "EVID"))
SAFE_PATH = re.compile(r"^[A-Za-z0-9_./@()\[\]-]+$")
TEST_DIR = re.compile(r"(^|/)(tests?|__tests__|e2e|spec)(/|$)")
CITE_STATUSES = {"VERIFIED_CLOSED", "FIXED_UNVERIFIED", "OPEN"}
REASON_STATUSES = {"BLOCKED", "NEEDS_HUMAN", "DEFERRED", "NOT_EXAMINED"}
errors = 0

def err(msg):
    global errors
    errors += 1
    print("  FAIL: " + msg)

def die(msg):
    print("  FAIL: " + msg)
    sys.exit(1)

def norm(k):
    return re.sub(r"[^a-z0-9]", "", str(k).lower())

def get(d, *names):
    m = {norm(k): v for k, v in d.items()}
    for n in names:
        v = m.get(norm(n))
        if v is not None and v != "" and v != []:
            return v
    return None

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as x:
        die("cannot read %s: %s" % (path, x))

def entries(doc, envkey):
    if isinstance(doc, list):
        return doc
    key = os.environ.get(envkey)
    if key:
        if isinstance(doc.get(key), list):
            return doc[key]
        die("%s=%s is not a list in the file" % (envkey, key))
    lists = {k: v for k, v in doc.items() if isinstance(v, list) and v and isinstance(v[0], dict)}
    if len(lists) == 1:
        return next(iter(lists.values()))
    die("cannot choose entries list (candidates: %s); set %s" % (sorted(lists), envkey))

def split_status(s):
    m = re.fullmatch(r"([A-Z_]+)(?:\((.+)\))?", s.strip(), re.S)
    return (m.group(1), m.group(2)) if m else (None, None)

def safe_repo_path(p):
    if not isinstance(p, str) or not SAFE_PATH.match(p) or p.startswith("/") or ".." in p.split("/"):
        return None
    full = os.path.realpath(os.path.join(ROOT, p))
    return full if full.startswith(ROOT + os.sep) else None

def check_cite(wid, p, lr):
    full = safe_repo_path(p)
    if not full or not os.path.isfile(full):
        err("%s: FILE_PATH is not a file in this repo: %r" % (wid, p)); return
    nums = [int(x) for x in re.findall(r"\d+", str(lr or ""))]
    if not nums:
        err("%s: LINE_RANGE missing or unparseable: %r" % (wid, lr)); return
    a, b = nums[0], nums[-1]
    with open(full, errors="replace") as f:
        lines = f.read().splitlines()
    if not (1 <= a <= b <= len(lines)):
        err("%s: LINE_RANGE %s-%s outside %s (%d lines)" % (wid, a, b, p, len(lines))); return
    if not any(l.strip() for l in lines[a - 1:b]):
        err("%s: cited lines %s-%s of %s are all blank" % (wid, a, b, p))

def exit_of(path):
    try:
        with open(path) as f:
            j = json.load(f)
    except Exception:
        return None
    v = get(j, "exit_code", "exitcode", "exit", "returncode", "code")
    try:
        return int(v)
    except (TypeError, ValueError):
        return None

def check_closed_evidence(wid):
    d = os.path.join(EVID, wid)
    for kind, want_zero in (("red", False), ("green", True)):
        fs = sorted(glob.glob(os.path.join(d, kind + "*.meta.json")))
        if not fs:
            err("%s: no %s evidence (%s/%s*.meta.json)" % (wid, kind, d, kind)); continue
        rc = exit_of(fs[0])
        if rc is None:
            err("%s: cannot read an exit code from %s (adapt exit_of() to run_and_record.sh format)" % (wid, fs[0]))
        elif want_zero and rc != 0:
            err("%s: green evidence has exit code %s" % (wid, rc))
        elif not want_zero and rc == 0:
            err("%s: red evidence has exit code 0 (test never failed)" % wid)
    if not glob.glob(os.path.join(d, "mutation*")):
        err("%s: no mutation-check evidence in %s" % (wid, d))

def load_enum():
    e = load(ENUM)
    return set(e["statuses"]), set(e.get("coverage_statuses", []))

def mode_ledger():
    allowed, _ = load_enum()
    items = entries(load(LEDGER), "LEDGER_LIST_KEY")
    counts = {}
    for e in items:
        wid = str(get(e, "WINDOW_ID", "id") or "?")
        raw = get(e, "STATUS", "FINAL_STATUS", "CLOSURE_STATUS")
        if not isinstance(raw, str):
            err("%s: no status field" % wid); continue
        base, arg = split_status(raw)
        if base not in allowed:
            err("%s: status %r is not in the allowed list" % (wid, raw)); continue
        if base == "IN_PROGRESS":
            err("%s: IN_PROGRESS cannot pass the gate" % wid)
        if base in REASON_STATUSES and not arg:
            err("%s: %s requires a reason in parentheses" % (wid, base))
        counts[base] = counts.get(base, 0) + 1
        if base in CITE_STATUSES:
            check_cite(wid, get(e, "FILE_PATH"), get(e, "LINE_RANGE"))
        if base == "VERIFIED_CLOSED":
            check_closed_evidence(wid)
    print("  ledger entries: %d  %s" % (len(items), json.dumps(counts, sort_keys=True)))
    sys.exit(1 if errors else 0)

def mode_closed(outpath):
    items = entries(load(LEDGER), "LEDGER_LIST_KEY")
    rows = []
    for e in items:
        wid = str(get(e, "WINDOW_ID", "id") or "?")
        raw = get(e, "STATUS", "FINAL_STATUS", "CLOSURE_STATUS")
        base, _ = split_status(raw) if isinstance(raw, str) else (None, None)
        if base != "VERIFIED_CLOSED":
            continue
        if not SAFE_PATH.match(wid.replace("-", "_")):
            err("%s: WINDOW_ID has unsafe characters" % wid); continue
        t = get(e, "POC_OR_FAILING_TEST_PATH", "REGRESSION_TEST_PATH")
        if not t:
            cand = get(e, "REQUIRED_REGRESSION_TEST")
            if isinstance(cand, str) and safe_repo_path(cand) and os.path.isfile(safe_repo_path(cand)):
                t = cand
        full = safe_repo_path(t) if t else None
        if not full or not os.path.isfile(full) or not TEST_DIR.search(t):
            err("%s: regression test path missing, unsafe, not in a tests/ dir, or not a file: %r" % (wid, t)); continue
        sup = get(e, "REGRESSION_TEST_SUPPORT_FILES") or []
        if isinstance(sup, str):
            sup = [s.strip() for s in sup.split(",") if s.strip()]
        ok = True
        for s in sup:
            sf = safe_repo_path(s)
            if not sf or not os.path.isfile(sf) or not TEST_DIR.search(s):
                err("%s: support file %r must be an existing file inside a tests/ dir" % (wid, s)); ok = False
        if not ok:
            continue
        reset = "1" if str(get(e, "REQUIRES_DB_RESET")).lower() in ("true", "1", "yes") else "0"
        rows.append("\t".join([wid, t, ",".join(sup) or "-", reset]))
    with open(outpath, "w") as f:
        f.write("\n".join(rows) + ("\n" if rows else ""))
    sys.exit(1 if errors else 0)

CITE_RX = re.compile(r"([\w./@()\[\]-]+\.[A-Za-z0-9]+)(?::|#L|\sL)(\d+)")

def mode_coverage():
    allowed, cov_allowed = load_enum()
    cov_allowed = cov_allowed | allowed
    doc = load(COVERAGE)
    units = entries(doc, "COVERAGE_LIST_KEY")
    window_ids = set()
    try:
        for e in entries(load(LEDGER), "LEDGER_LIST_KEY"):
            window_ids.add(str(get(e, "WINDOW_ID", "id")))
    except SystemExit:
        pass
    counts = {}
    for u in units:
        uid = str(get(u, "UNIT_ID", "id", "name") or "?")
        raw = get(u, "DISPOSITION", "STATUS")
        if not isinstance(raw, str):
            err("%s: no disposition" % uid); continue
        base, arg = split_status(raw)
        if base not in cov_allowed:
            err("%s: disposition %r not allowed" % (uid, raw)); continue
        counts[base] = counts.get(base, 0) + 1
        if base == "FINDING":
            fid = (arg or str(get(u, "WINDOW_ID") or "")).strip()
            if fid not in window_ids:
                err("%s: FINDING references %r which is not in the ledger" % (uid, fid))
        if base == "REVIEWED_SAFE":
            proof = get(u, "PROOF_REFERENCE", "PROOF", "EVIDENCE", "JUSTIFICATION", "REASON")
            if not isinstance(proof, str) or len(proof.strip()) < 60:
                err("%s: REVIEWED_SAFE needs a proof reference of at least 60 chars (file:line + reasoning)" % uid); continue
            cites = CITE_RX.findall(proof)
            if not cites:
                err("%s: proof has no file:line citation" % uid); continue
            for p, ln in cites:
                full = safe_repo_path(p)
                if not full or not os.path.isfile(full):
                    err("%s: proof cites missing file %s" % (uid, p)); continue
                with open(full, errors="replace") as f:
                    n = len(f.read().splitlines())
                if int(ln) > n or int(ln) < 1:
                    err("%s: proof cites %s:%s beyond end of file (%d lines)" % (uid, p, ln, n))
        if base in REASON_STATUSES and not arg:
            err("%s: %s requires a reason in parentheses" % (uid, base))
    declared = get(doc, "TOTAL_UNITS", "INVENTORY_COUNT", "TOTAL") if isinstance(doc, dict) else None
    if isinstance(declared, int) and declared != len(units):
        err("declared total %d != actual units %d" % (declared, len(units)))
    print("  coverage units: %d  %s" % (len(units), json.dumps(counts, sort_keys=True)))
    sys.exit(1 if errors else 0)

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "ledger": mode_ledger()
    elif mode == "closed": mode_closed(sys.argv[2])
    elif mode == "coverage": mode_coverage()
    else: die("unknown mode")
PY

# ------------------------------------------------------------------ 0. gate integrity
section "0. Gate integrity (human-reviewed files must be unchanged)"
GATE_FILES=(.gsd/gate.sh .github/workflows/security-gate.yml .gsd/schemas/status-enum.json .gitleaks.toml .github/CODEOWNERS)
if [ -z "${GATE_PIN_SHA:-}" ]; then
  fail "HUMAN REVIEW REQUIRED: GATE_PIN_SHA is not set. A human must review the gate files, then set repo variable GATE_PIN_SHA to that commit. Agents must not work around this."
elif ! git cat-file -e "$GATE_PIN_SHA^{commit}" 2>/dev/null || ! git merge-base --is-ancestor "$GATE_PIN_SHA" HEAD; then
  fail "GATE_PIN_SHA $GATE_PIN_SHA is not an ancestor of HEAD"
else
  changed=0
  for f in "${GATE_FILES[@]}"; do
    if ! git diff --quiet "$GATE_PIN_SHA" HEAD -- "$f"; then fail "HUMAN REVIEW REQUIRED: $f changed since pinned commit"; changed=1; fi
  done
  if ! git diff --quiet "$GATE_PIN_SHA" HEAD -- .agents/rules; then fail "HUMAN REVIEW REQUIRED: .agents/rules changed since pinned commit"; changed=1; fi
  [ $changed -eq 0 ] && pass "gate files identical to pinned commit $GATE_PIN_SHA"
fi

# ------------------------------------------------------------------ evidence availability
if [ ! -d "$EVID" ] && [ -f .gsd/evidence.tar.gz ]; then
  tar -xzf .gsd/evidence.tar.gz -C .gsd && echo "(extracted .gsd/evidence.tar.gz)"
fi

# ------------------------------------------------------------------ 1. ledger
section "1. Findings ledger: statuses, citations, evidence"
python3 "$TMP/gate_lib.py" ledger || FAILURES=$((FAILURES+1))

# ------------------------------------------------------------------ 2. coverage
section "2. Coverage ledger: dispositions and proof references"
python3 "$TMP/gate_lib.py" coverage || FAILURES=$((FAILURES+1))

# ------------------------------------------------------------------ 3. independent red/green
section "3. Independent red (base) / green (head) re-proof"
runner_for() {
  case "$1" in
    *.spec.ts|*.spec.js) echo "${RUNNER_PLAYWRIGHT:-npx playwright test}";;
    *.mjs|*.cjs|*.js)    echo "${RUNNER_NODE:-node --test}";;
    *.ts|*.tsx)          echo "${RUNNER_TS:-npx tsx --test}";;
    *.py)                echo "${RUNNER_PY:-python3 -m pytest -x -q}";;
    *)                   echo "";;
  esac
}
run_in() { timeout "${GATE_TIMEOUT:-600}" bash -c "cd \"$1\" && $2"; }
INFRA='ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (module|package)|SyntaxError|ECONNREFUSED|command not found|ENOENT'

if python3 "$TMP/gate_lib.py" closed "$TMP/closed.tsv"; then :; else FAILURES=$((FAILURES+1)); fi
if [ -s "$TMP/closed.tsv" ]; then
  git worktree add --detach "$BASEWT" "$BASE_SHA" >/dev/null 2>&1 || { fail "cannot create base worktree at $BASE_SHA"; }
  if [ -d "$BASEWT" ]; then
    # reuse installed dependencies in the base worktree
    while IFS= read -r nm; do
      rel="${nm#./}"; [ -e "$BASEWT/$rel" ] || { mkdir -p "$BASEWT/$(dirname "$rel")"; ln -s "$ROOT/$rel" "$BASEWT/$rel"; }
    done < <(find . -maxdepth 4 -name node_modules -type d -prune -not -path './.gsd/*' 2>/dev/null)
    while IFS=$'\t' read -r id test support reset; do
      runner="$(runner_for "$test")"
      if [ -z "$runner" ]; then fail "$id: no runner configured for $test"; continue; fi
      git -C "$BASEWT" checkout -q -- . 2>/dev/null; git -C "$BASEWT" clean -fdq
      files="$test"; [ "$support" != "-" ] && files="$test ${support//,/ }"
      for f in $files; do mkdir -p "$BASEWT/$(dirname "$f")"; cp "$ROOT/$f" "$BASEWT/$f"; done
      [ "$reset" = "1" ] && run_in "$BASEWT" "${DB_RESET_CMD:-supabase db reset}" >"$LOGDIR/$id.base-reset.log" 2>&1
      run_in "$BASEWT" "$runner '$test'" >"$LOGDIR/$id.red.log" 2>&1; rc=$?
      if [ $rc -eq 0 ]; then
        fail "$id: regression test PASSES on base commit (not a real regression test, or bug absent at base)"
      elif [ $rc -eq 124 ] || [ $rc -eq 126 ] || [ $rc -eq 127 ]; then
        fail "$id: base run errored (rc=$rc), not a genuine red; see $LOGDIR/$id.red.log"
      elif grep -Eq "$INFRA" "$LOGDIR/$id.red.log"; then
        fail "$id: base failure looks infrastructural, not the vulnerability; see $LOGDIR/$id.red.log"; tail -n 15 "$LOGDIR/$id.red.log"
      else
        pass "$id: RED on base (rc=$rc)"
      fi
      [ "$reset" = "1" ] && run_in "$ROOT" "${DB_RESET_CMD:-supabase db reset}" >"$LOGDIR/$id.head-reset.log" 2>&1
      run_in "$ROOT" "$runner '$test'" >"$LOGDIR/$id.green.log" 2>&1; rc=$?
      if [ $rc -eq 0 ]; then pass "$id: GREEN on head"; else fail "$id: test FAILS on head (rc=$rc)"; tail -n 15 "$LOGDIR/$id.green.log"; fi
    done < "$TMP/closed.tsv"
  fi
else
  echo "  (no VERIFIED_CLOSED windows to re-prove)"
fi

# ------------------------------------------------------------------ 4. banned tokens in diff
section "4. Banned tokens in added lines (base...head)"
EXCL=(':(exclude).gsd' ':(exclude).agents' ':(exclude)*.md' ':(exclude).github/workflows/security-gate*.yml'
      ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock')
git diff --unified=0 --no-color "$BASE_SHA...HEAD" -- . "${EXCL[@]}" \
  | awk '/^\+\+\+ /{f=substr($0,7);next} /^\+/{print f": "substr($0,2)}' > "$TMP/added.txt"
BANNED='(^|[^A-Za-z0-9_])(TODO|FIXME)([^A-Za-z0-9_]|$)|@ts-ignore|@ts-nocheck|eslint-disable|\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b|\.only\(|--no-verify'
ANYRX='(:[[:space:]]*any\b|\bas any\b|<any>)'
hits="$(grep -nE "$BANNED" "$TMP/added.txt" || true)"
anyhits="$(grep -E '^[^:]+\.(ts|tsx): ' "$TMP/added.txt" | grep -nE "$ANYRX" || true)"
if [ -n "$hits$anyhits" ]; then fail "banned tokens added by this diff:"; printf '%s\n%s\n' "$hits" "$anyhits" | sed '/^$/d;s/^/    /'
else pass "no banned tokens in added lines"; fi

# ------------------------------------------------------------------ 5. gitleaks + ignore file
section "5. Secrets: gitleaks and .gitleaksignore"
badignore="$(git diff --unified=0 --no-color "$BASE_SHA...HEAD" -- .gitleaksignore | grep -E '^\+[^+]' | sed 's/^+//' \
  | grep -vE '^[[:space:]]*(#|$)' | awk -F: '/[*?]/ || /\/[[:space:]]*$/ || NF<3 {print}' || true)"
if [ -n "$badignore" ]; then fail ".gitleaksignore additions must be fingerprint-specific (no wildcards, no dirs):"; echo "$badignore" | sed 's/^/    /'
else pass ".gitleaksignore additions (if any) are fingerprint-specific"; fi
if git diff --quiet "$BASE_SHA...HEAD" -- .gitleaks.toml; then :; else fail "HUMAN REVIEW REQUIRED: .gitleaks.toml changed"; fi
if ! command -v gitleaks >/dev/null 2>&1; then
  fail "gitleaks not installed; cannot verify secrets"
else
  gitleaks detect --source . --log-opts "$BASE_SHA..HEAD" --redact --no-banner >"$LOGDIR/gitleaks-commits.log" 2>&1 \
    && pass "gitleaks: no leaks in PR commits" || { fail "gitleaks found leaks in PR commits (see $LOGDIR/gitleaks-commits.log)"; tail -n 20 "$LOGDIR/gitleaks-commits.log"; }
  if [ -d .gsd ]; then
    gitleaks detect --no-git --source .gsd --redact --no-banner >"$LOGDIR/gitleaks-gsd.log" 2>&1 \
      && pass "gitleaks: .gsd/ (including evidence) clean" || { fail "gitleaks found leaks in .gsd/ (see $LOGDIR/gitleaks-gsd.log)"; tail -n 20 "$LOGDIR/gitleaks-gsd.log"; }
  fi
fi

# ------------------------------------------------------------------ 6. evidence manifest
section "6. Evidence manifest"
if [ ! -d "$EVID" ]; then
  fail "evidence directory $EVID missing (commit redacted evidence or .gsd/evidence.tar.gz; it is currently gitignored if absent here)"
elif [ ! -f "$EVID/MANIFEST.sha256" ]; then
  fail "$EVID/MANIFEST.sha256 missing"
else
  ( cd "$EVID" && sha256sum -c --quiet MANIFEST.sha256 ) >"$LOGDIR/manifest.log" 2>&1 \
    && pass "every listed evidence file matches its SHA256" || { fail "manifest mismatch"; head -n 10 "$LOGDIR/manifest.log"; }
  extra="$( cd "$EVID" && find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | while read -r f; do grep -qF "  $f" MANIFEST.sha256 || echo "$f"; done )"
  [ -z "$extra" ] && pass "no unlisted evidence files" || { fail "evidence files not in manifest:"; echo "$extra" | sed 's/^/    /'; }
  echo "  manifest sha256: $(sha256sum "$EVID/MANIFEST.sha256" | cut -d' ' -f1)"
fi

# ------------------------------------------------------------------ result
echo
if [ "$FAILURES" -eq 0 ]; then echo "GATE RESULT: PASS"; exit 0; fi
echo "GATE RESULT: FAIL ($FAILURES failing check(s))"; exit 1

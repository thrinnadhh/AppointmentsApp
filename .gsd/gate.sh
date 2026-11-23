#!/usr/bin/env bash
# .gsd/gate.sh (v3)  --  Independent security-closure gate.
# Runs in CI on a machine the agent does not control. It does NOT trust agent-written
# results: it re-proves red/green itself and validates ledgers against the real repo.
#
# Usage:  bash .gsd/gate.sh            run all checks (exit 1 on any failure)
#         bash .gsd/gate.sh manifest   regenerate .gsd/evidence/MANIFEST.sha256
#
# Env: BASE_SHA (fallback base), SCAN_BASE_SHA (start of the campaign: diff/secret scans),
#      RED_BASE_SHA (pre-fix commit for red runs), GATE_PIN_SHA (human-reviewed gate commit),
#      LEDGER / COVERAGE / ENUM / EVID, RUNNER_NODE / RUNNER_TS / RUNNER_PLAYWRIGHT / RUNNER_PY,
#      DB_RESET_CMD, GATE_TIMEOUT.
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
SCAN_BASE_SHA="${SCAN_BASE_SHA:-$BASE_SHA}"
RED_BASE_SHA="${RED_BASE_SHA:-$BASE_SHA}"
HEAD_SHA="$(git rev-parse HEAD)"
for s in "$SCAN_BASE_SHA" "$RED_BASE_SHA"; do
  [ -n "$s" ] || { echo "FATAL: no base commit (set BASE_SHA / SCAN_BASE_SHA / RED_BASE_SHA)"; exit 2; }
  git cat-file -e "$s^{commit}" 2>/dev/null || { echo "FATAL: commit $s not found (checkout needs fetch-depth: 0)"; exit 2; }
  git merge-base --is-ancestor "$s" HEAD || { echo "FATAL: $s is not an ancestor of HEAD"; exit 2; }
done

FAILURES=0
pass()    { echo "  PASS: $*"; }
fail()    { echo "  FAIL: $*"; FAILURES=$((FAILURES+1)); }
section() { echo; echo "== $* =="; }

TMP="$(mktemp -d)"
BASEWT="$TMP/base"
cleanup() { git worktree remove --force "$BASEWT" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "gate v3: head=$HEAD_SHA scan_base=$SCAN_BASE_SHA red_base=$RED_BASE_SHA"

# ------------------------------------------------------------------ python helper
cat > "$TMP/gate_lib.py" <<'PY'
import hashlib, json, glob, os, re, subprocess, sys

ROOT = os.getcwd()
LEDGER, COVERAGE, ENUM, EVID = (os.environ[k] for k in ("LEDGER", "COVERAGE", "ENUM", "EVID"))
SAFE_PATH = re.compile(r"^[A-Za-z0-9_./@()\[\]-]+$")
TEST_DIR = re.compile(r"(^|/)(tests?|__tests__|e2e|spec)(/|$)")
CITE_STATUSES = {"VERIFIED_CLOSED", "FIXED_UNVERIFIED", "OPEN"}
REASON_STATUSES = {"BLOCKED", "NEEDS_HUMAN", "DEFERRED", "NOT_EXAMINED"}
FIELD_RX = re.compile(r"^([A-Z][A-Z0-9_]+):[ \t]*(.*)$")
errors = 0

def err(msg):
    global errors
    errors += 1
    print("  FAIL: " + msg)

def warn(msg):
    print("  WARN: " + msg)

def die(msg):
    print("  FAIL: " + msg)
    sys.exit(1)

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
    if key and isinstance(doc.get(key), list):
        return doc[key]
    lists = {k: v for k, v in doc.items() if isinstance(v, list) and v and isinstance(v[0], dict)}
    if len(lists) == 1:
        return next(iter(lists.values()))
    die("cannot choose entries list (candidates: %s); set %s" % (sorted(lists), envkey))

def split_status(s):
    m = re.fullmatch(r"([A-Z_]+)(?:\((.+)\))?", str(s).strip(), re.S)
    return (m.group(1), m.group(2)) if m else (None, None)

def safe_repo_path(p, must_be_file=False):
    if not isinstance(p, str) or not SAFE_PATH.match(p) or p.startswith("/") or ".." in p.split("/"):
        return None
    full = os.path.realpath(os.path.join(ROOT, p))
    if not full.startswith(ROOT + os.sep):
        return None
    if must_be_file and not os.path.isfile(full):
        return None
    return full

def parse_desc(desc):
    out, cur = {}, None
    for line in str(desc or "").splitlines():
        m = FIELD_RX.match(line)
        if m:
            cur = m.group(1)
            out[cur] = m.group(2).strip()
        elif cur and line.strip():
            out[cur] += " " + line.strip()
    return out

def norm_entry(e, report=True):
    bad = err if report else (lambda m: None)
    d = parse_desc(e.get("description"))
    wid = str(e.get("fingerprint") or d.get("ISSUE_ID") or "?")
    if d.get("ISSUE_ID") and e.get("fingerprint") and d["ISSUE_ID"] != e["fingerprint"]:
        bad("%s: fingerprint != ISSUE_ID (%s)" % (wid, d["ISSUE_ID"]))
    tm = re.match(r"\s*\[([A-Z_]+)\]", str(e.get("title", "")))
    st_title = tm.group(1) if tm else None
    st = d.get("STATUS") or st_title
    if st_title and d.get("STATUS") and split_status(d["STATUS"])[0] != st_title:
        bad("%s: title says [%s] but STATUS says %s" % (wid, st_title, d["STATUS"]))
    return {"id": wid, "status": st, "file": d.get("FILE_PATH"), "lines": d.get("LINE_RANGE"),
            "test": d.get("REQUIRED_REGRESSION_TEST"), "gov": d.get("GOVERNANCE_DOC"),
            "cls": d.get("CLASSIFICATION")}

def check_cite(wid, p, lr):
    full = safe_repo_path(p, True)
    if not full:
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
            v = json.load(f).get("exit_code")
        return int(v)
    except Exception:
        return None

def check_closed_evidence(wid):
    d = os.path.join(EVID, wid)
    for kind, want_zero in (("red", False), ("green", True)):
        fs = sorted(glob.glob(os.path.join(d, kind + "*.meta.json")))
        if not fs:
            err("%s: no %s evidence (%s/%s*.meta.json)" % (wid, kind, d, kind)); continue
        rc = exit_of(fs[0])
        if rc is None:
            err("%s: no integer exit_code in %s" % (wid, fs[0]))
        elif want_zero and rc != 0:
            err("%s: green evidence has exit_code %s" % (wid, rc))
        elif not want_zero and rc == 0:
            err("%s: red evidence has exit_code 0 (test never failed)" % wid)
    if not glob.glob(os.path.join(d, "mutation*")):
        err("%s: no mutation-check evidence in %s" % (wid, d))

def load_enum():
    e = load(ENUM)
    return set(e["statuses"]), set(e.get("coverage_statuses", []))

def ledger_ids():
    try:
        return {norm_entry(e, False)["id"] for e in entries(load(LEDGER), "LEDGER_LIST_KEY")}
    except SystemExit:
        return set()

def mode_ledger():
    allowed, _ = load_enum()
    items = entries(load(LEDGER), "LEDGER_LIST_KEY")
    counts, seen = {}, set()
    for e in items:
        n = norm_entry(e)
        wid = n["id"]
        if wid in seen:
            err("%s: duplicate WINDOW_ID" % wid)
        seen.add(wid)
        if not n["status"]:
            err("%s: no STATUS in description or title" % wid); continue
        base, arg = split_status(n["status"])
        if base not in allowed:
            err("%s: status %r is not in the allowed list" % (wid, n["status"])); continue
        if base == "IN_PROGRESS":
            err("%s: IN_PROGRESS cannot pass the gate" % wid)
        if base in REASON_STATUSES and not (arg or n["gov"] or n["cls"]):
            err("%s: %s needs a reason (parenthesis, CLASSIFICATION or GOVERNANCE_DOC)" % (wid, base))
        if n["gov"] and not safe_repo_path(n["gov"], True):
            err("%s: GOVERNANCE_DOC %r does not exist" % (wid, n["gov"]))
        counts[base] = counts.get(base, 0) + 1
        if base in CITE_STATUSES:
            check_cite(wid, n["file"], n["lines"])
        if base == "VERIFIED_CLOSED":
            check_closed_evidence(wid)
    print("  ledger entries: %d  %s" % (len(items), json.dumps(counts, sort_keys=True)))
    sys.exit(1 if errors else 0)

def mode_closed(outpath):
    rows = []
    for e in entries(load(LEDGER), "LEDGER_LIST_KEY"):
        n = norm_entry(e, False)
        base, _ = split_status(n["status"]) if n["status"] else (None, None)
        if base != "VERIFIED_CLOSED":
            continue
        wid, t = n["id"], (n["test"] or "").strip()
        if not SAFE_PATH.match(wid):
            err("%s: WINDOW_ID has unsafe characters" % wid); continue
        full = safe_repo_path(t, True)
        if not full or not TEST_DIR.search(t):
            err("%s: REQUIRED_REGRESSION_TEST must be an existing file in a tests/ dir, got %r" % (wid, t)); continue
        rows.append("\t".join([wid, t, "-", "0"]))
    with open(outpath, "w") as f:
        f.write("\n".join(rows) + ("\n" if rows else ""))
    sys.exit(1 if errors else 0)

REF_RX = re.compile(r"\s*REVIEWED_SAFE\(([^)]*)\)\s*:?\s*(.*)", re.S)

def check_ref(uid, ref):
    ok = False
    for tok in re.split(r"[,\s;]+", ref):
        tok = re.sub(r"#.*$", "", tok)
        tok = re.sub(r":\d+(-\d+)?$", "", tok)
        if not tok or not ("/" in tok or "." in tok):
            continue
        if tok.startswith((".gsd/", ".agents/")) or tok in ("FULL_SECURITY_CLOSURE_REPORT.md", "MEMORY.md"):
            err("%s: proof cites agent-authored notes (%s); cite a test or source file instead" % (uid, tok)); return False
        if not safe_repo_path(tok) or not os.path.exists(os.path.join(ROOT, tok)):
            hint = " (bare filename: give the full repo path)" if "/" not in tok else ""
            err("%s: proof reference %r does not exist in the repo%s" % (uid, tok, hint)); return False
        ok = True
    if not ok:
        err("%s: proof reference %r contains no repo path" % (uid, ref))
    return ok

def existed_in_history(p):
    try:
        r = subprocess.run(["git", "log", "--oneline", "-1", "--", p], capture_output=True, text=True, timeout=60)
        return bool(r.stdout.strip())
    except Exception:
        return False

def mode_coverage():
    _, cov_allowed = load_enum()
    units = entries(load(COVERAGE), "COVERAGE_LIST_KEY")
    ids = ledger_ids()
    counts, agents = {}, set()
    for u in units:
        uid = str(u.get("surface") or u.get("id") or "?")
        st = str(u.get("status") or u.get("disposition") or "").strip()
        agents.add(str(u.get("agent_id")))
        counts[st] = counts.get(st, 0) + 1
        if u.get("unresolved"):
            err("%s: has unresolved items: %r" % (uid, u["unresolved"]))
        for p in (u.get("reviewed_paths") or []):
            pp = re.sub(r"#.*$", "", str(p))
            if not safe_repo_path(pp) or not (os.path.exists(os.path.join(ROOT, pp)) or glob.glob(os.path.join(ROOT, pp))):
                if st == "candidate" and safe_repo_path(pp) and existed_in_history(pp):
                    continue
                err("%s: reviewed path %r does not exist" % (uid, p))
        base, arg = split_status(st) if st else (None, None)
        if st == "covered" or base == "REVIEWED_SAFE":
            checks = u.get("local_checks") or []
            good = False
            for c in checks:
                m = REF_RX.match(str((c or {}).get("result", "")))
                if not m:
                    continue
                if len(m.group(2).strip()) < 40:
                    err("%s: REVIEWED_SAFE reasoning shorter than 40 chars" % uid); continue
                if check_ref(uid, m.group(1)):
                    good = True
            if not good and not any(REF_RX.match(str((c or {}).get("result", ""))) for c in checks):
                err("%s: 'covered' but no local_check result of the form REVIEWED_SAFE(<path>): <reasoning>" % uid)
        elif st == "candidate" or base == "FINDING":
            fps = u.get("result_fingerprints") or ([arg] if arg else [])
            if not fps:
                err("%s: candidate with no result_fingerprints (unresolved)" % uid)
            for fp in fps:
                if fp not in ids:
                    err("%s: references %r which is not in the findings ledger" % (uid, fp))
        elif base in cov_allowed and base in REASON_STATUSES:
            if not arg:
                err("%s: %s requires a reason" % (uid, base))
        else:
            err("%s: unrecognised status %r" % (uid, st))
    if len(units) > 10 and len(agents) == 1:
        warn("all %d coverage units were authored by one agent_id (%s): no independent review is recorded" % (len(units), next(iter(agents))))
    print("  coverage units: %d  %s" % (len(units), json.dumps(counts, sort_keys=True)))
    sys.exit(1 if errors else 0)

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def mode_manifest():
    man = os.path.join(EVID, "MANIFEST.sha256")
    if not os.path.isfile(man):
        die("%s missing" % man)
    listed = {}
    for line in open(man, errors="replace"):
        m = re.match(r"^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$", line)
        if m:
            p = re.sub(r"^\./", "", m.group(2))
            p = re.sub(r"^(\.gsd/)?evidence/", "", p)
            listed[p] = m.group(1).lower()
    if not listed:
        die("manifest has no parseable '<sha256>  <path>' lines")
    for p, h in sorted(listed.items()):
        fp = os.path.join(EVID, p)
        if not os.path.isfile(fp):
            err("manifest lists missing file: %s" % p)
        elif sha256(fp) != h:
            err("hash mismatch: %s" % p)
    unlisted = []
    for dp, _, fs in os.walk(EVID):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), EVID)
            if os.path.basename(rel).startswith("._"):
                continue
            if rel != "MANIFEST.sha256" and rel not in listed:
                unlisted.append(rel)
    if unlisted:
        err("%d evidence file(s) not in manifest, e.g. %s" % (len(unlisted), ", ".join(sorted(unlisted)[:5])))
    print("  manifest entries: %d   manifest sha256: %s" % (len(listed), sha256(man)))
    sys.exit(1 if errors else 0)

if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "ledger": mode_ledger()
    elif mode == "closed": mode_closed(sys.argv[2])
    elif mode == "coverage": mode_coverage()
    elif mode == "manifest": mode_manifest()
    else: die("unknown mode")
PY

# ------------------------------------------------------------------ 0. gate integrity
section "0. Gate integrity (human-reviewed files must be unchanged)"
GATE_FILES=(.gsd/gate.sh .github/workflows/security-gate-independent.yml .gsd/schemas/status-enum.json .gitleaks.toml .github/CODEOWNERS)
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

# ------------------------------------------------------------------ evidence source
section "Evidence source"
if [ -d "$EVID" ]; then
  echo "  using working-tree evidence directory $EVID"
else
  extracted=0
  for a in .gsd/evidence_archive.tar.gz .gsd/evidence.tar.gz; do
    [ -f "$a" ] || continue
    mkdir -p "$TMP/evx"
    if tar -xzf "$a" -C "$TMP/evx" 2>"$LOGDIR/untar.log"; then
      m="$(find "$TMP/evx" -name MANIFEST.sha256 -print -quit)"
      if [ -n "$m" ]; then EVID="$(dirname "$m")"; export EVID; extracted=1; echo "  extracted $a -> evidence root"; break; fi
      fail "$a contains no MANIFEST.sha256"
    else
      fail "cannot extract $a (see $LOGDIR/untar.log)"
    fi
  done
  [ $extracted -eq 1 ] || fail "no evidence directory and no usable evidence archive (.gsd/evidence_archive.tar.gz)"
fi

# ------------------------------------------------------------------ 1. ledger
section "1. Findings ledger: statuses, citations, evidence"
python3 "$TMP/gate_lib.py" ledger || FAILURES=$((FAILURES+1))

# ------------------------------------------------------------------ 2. coverage
section "2. Coverage ledger: statuses, references, proofs"
python3 "$TMP/gate_lib.py" coverage || FAILURES=$((FAILURES+1))

# ------------------------------------------------------------------ 3. independent red/green
section "3. Independent red (pre-fix commit) / green (head) re-proof"
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
  git worktree add --detach "$BASEWT" "$RED_BASE_SHA" >/dev/null 2>&1 || fail "cannot create worktree at $RED_BASE_SHA"
  if [ -d "$BASEWT" ]; then
    while IFS= read -r nm; do
      rel="${nm#./}"; [ -e "$BASEWT/$rel" ] || { mkdir -p "$BASEWT/$(dirname "$rel")"; ln -s "$ROOT/$rel" "$BASEWT/$rel"; }
    done < <(find . -maxdepth 4 -name node_modules -type d -prune -not -path './.gsd/*' 2>/dev/null)
    while IFS=$'\t' read -r id test support reset; do
      runner="$(runner_for "$test")"
      if [ -z "$runner" ]; then fail "$id: no runner configured for $test"; continue; fi
      git -C "$BASEWT" checkout -q -- . 2>/dev/null; git -C "$BASEWT" clean -fdq
      mkdir -p "$BASEWT/$(dirname "$test")"; cp "$ROOT/$test" "$BASEWT/$test"
      [ "$reset" = "1" ] && run_in "$BASEWT" "${DB_RESET_CMD:-supabase db reset}" >"$LOGDIR/$id.base-reset.log" 2>&1
      run_in "$BASEWT" "$runner '$test'" >"$LOGDIR/$id.red.log" 2>&1; rc=$?
      if [ $rc -eq 0 ]; then
        fail "$id: regression test PASSES on pre-fix commit $RED_BASE_SHA (not a real regression test, or bug absent there)"
      elif [ $rc -eq 124 ] || [ $rc -eq 126 ] || [ $rc -eq 127 ]; then
        fail "$id: pre-fix run errored (rc=$rc), not a genuine red; see $LOGDIR/$id.red.log"
      elif grep -Eq "$INFRA" "$LOGDIR/$id.red.log"; then
        fail "$id: pre-fix failure looks infrastructural, not the vulnerability; see $LOGDIR/$id.red.log"; tail -n 15 "$LOGDIR/$id.red.log"
      else
        pass "$id: RED on pre-fix commit (rc=$rc)"
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
section "4. Banned tokens in lines added since campaign start"
EXCL=(':(exclude).gsd' ':(exclude).agents' ':(exclude)*.md' ':(exclude).github/workflows/security-gate-independent.yml'
      ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock')
git diff --unified=0 --no-color "$SCAN_BASE_SHA...HEAD" -- . "${EXCL[@]}" \
  | awk '/^\+\+\+ /{f=substr($0,7);next} /^\+/{print f": "substr($0,2)}' > "$TMP/added.txt"
BANNED='(^|[^A-Za-z0-9_])(TODO|FIXME)([^A-Za-z0-9_]|$)|@ts-ignore|@ts-nocheck|eslint-disable|\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b|\.only\(|--no-verify'
ANYRX='(:[[:space:]]*any\b|\bas any\b|<any>)'
hits="$(grep -nE "$BANNED" "$TMP/added.txt" || true)"
anyhits="$(grep -E '^[^:]+\.(ts|tsx): ' "$TMP/added.txt" | grep -nE "$ANYRX" || true)"
if [ -n "$hits$anyhits" ]; then fail "banned tokens added since $SCAN_BASE_SHA:"; printf '%s\n%s\n' "$hits" "$anyhits" | sed '/^$/d;s/^/    /'
else pass "no banned tokens in added lines"; fi

# ------------------------------------------------------------------ 5. gitleaks + ignore file
section "5. Secrets: gitleaks and .gitleaksignore"
badignore="$(git diff --unified=0 --no-color "$SCAN_BASE_SHA...HEAD" -- .gitleaksignore | grep -E '^\+[^+]' | sed 's/^+//' \
  | grep -vE '^[[:space:]]*(#|$)' | awk -F: '/[*?]/ || /\/[[:space:]]*$/ || NF<3 {print}' || true)"
if [ -n "$badignore" ]; then fail ".gitleaksignore additions must be fingerprint-specific (no wildcards, no dirs):"; echo "$badignore" | sed 's/^/    /'
else pass ".gitleaksignore additions (if any) are fingerprint-specific"; fi
if git diff --quiet "$SCAN_BASE_SHA...HEAD" -- .gitleaks.toml; then :; else fail "HUMAN REVIEW REQUIRED: .gitleaks.toml changed"; fi
if ! command -v gitleaks >/dev/null 2>&1; then
  fail "gitleaks not installed; cannot verify secrets"
else
  gitleaks detect --source . --log-opts "$SCAN_BASE_SHA..HEAD" --redact --no-banner >"$LOGDIR/gitleaks-commits.log" 2>&1 \
    && pass "gitleaks: no leaks in commits since campaign start" || { fail "gitleaks found leaks (see $LOGDIR/gitleaks-commits.log)"; tail -n 20 "$LOGDIR/gitleaks-commits.log"; }
  gitleaks detect --no-git --source "$EVID" --redact --no-banner >"$LOGDIR/gitleaks-evidence.log" 2>&1 \
    && pass "gitleaks: evidence clean" || { fail "gitleaks found leaks in evidence (see $LOGDIR/gitleaks-evidence.log)"; tail -n 20 "$LOGDIR/gitleaks-evidence.log"; }
fi

# ------------------------------------------------------------------ 6. evidence manifest
section "6. Evidence manifest"
python3 "$TMP/gate_lib.py" manifest || FAILURES=$((FAILURES+1))

# ------------------------------------------------------------------ result
echo
if [ "$FAILURES" -eq 0 ]; then echo "GATE RESULT: PASS"; exit 0; fi
echo "GATE RESULT: FAIL ($FAILURES failing check(s))"; exit 1

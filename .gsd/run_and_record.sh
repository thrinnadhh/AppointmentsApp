#!/usr/bin/env bash
# .gsd/run_and_record.sh
# Hardened execution wrapper capturing stdout, stderr, exit code, UTC timestamp,
# HEAD sha, command, working dir into .gsd/evidence/<ID>/<name>.{out,err,meta.json}
# and {stdout,stderr,exitcode}.
# Redacts secrets before writing.

set -u

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <STAGE_OR_WINDOW_ID> <STEP_NAME> <COMMAND...>" >&2
  exit 1
fi

TARGET="$1"
STEP="$2"
shift 2

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_DIR="${REPO_ROOT}/.gsd/evidence/${TARGET}"
mkdir -p "${EVIDENCE_DIR}"

STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
HEAD_REV="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo "UNKNOWN")"
WORKING_DIR="$(pwd)"

OUT_FILE="${EVIDENCE_DIR}/${STEP}.out"
ERR_FILE="${EVIDENCE_DIR}/${STEP}.err"
STDOUT_FILE="${EVIDENCE_DIR}/${STEP}.stdout"
STDERR_FILE="${EVIDENCE_DIR}/${STEP}.stderr"
EXIT_FILE="${EVIDENCE_DIR}/${STEP}.exitcode"
META_FILE="${EVIDENCE_DIR}/${STEP}.meta.json"

TMP_OUT="$(mktemp)"
TMP_ERR="$(mktemp)"

START_TIME="$(date +%s)"
"$@" > "${TMP_OUT}" 2> "${TMP_ERR}"
EXIT_CODE=$?
END_TIME="$(date +%s)"
DURATION=$((END_TIME - START_TIME))

python3 - "${TMP_OUT}" "${OUT_FILE}" "${STDOUT_FILE}" "${TMP_ERR}" "${ERR_FILE}" "${STDERR_FILE}" << 'EOF'
import sys, re

patterns = [
    (re.compile(r'eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}'), '[REDACTED_JWT]'),
    (re.compile(r'Bearer\s+[a-zA-Z0-9_\-\.]{15,}'), 'Bearer [REDACTED]'),
    (re.compile(r'cfsk_ma_[a-zA-Z0-9_\-]{10,}'), '[REDACTED_CFSK]'),
    (re.compile(r'whsec_[a-zA-Z0-9_\-]{10,}'), '[REDACTED_WHSEC]'),
    (re.compile(r'(?i)"?(password|secret|api[_-]?key|token)"?\s*([:=])\s*["\']?([a-zA-Z0-9_\-\.]{8,})["\']?'), r'"\1"\2"[REDACTED]"')
]

def redact_file(src_path, dst_paths):
    try:
        with open(src_path, 'r', errors='replace') as f:
            content = f.read()
    except Exception:
        content = ""
    for pat, rep in patterns:
        content = pat.sub(rep, content)
    for dst in dst_paths:
        with open(dst, 'w') as f:
            f.write(content)

redact_file(sys.argv[1], [sys.argv[2], sys.argv[3]])
redact_file(sys.argv[4], [sys.argv[5], sys.argv[6]])
EOF

rm -f "${TMP_OUT}" "${TMP_ERR}"

echo -n "${EXIT_CODE}" > "${EXIT_FILE}"

CMD_STR="$*"
python3 - "${TARGET}" "${STEP}" "${CMD_STR}" "${HEAD_REV}" "${STAMP}" "${WORKING_DIR}" "${DURATION}" "${EXIT_CODE}" "${OUT_FILE}" "${ERR_FILE}" "${META_FILE}" << 'EOF'
import json, sys

data = {
    'target': sys.argv[1],
    'step': sys.argv[2],
    'command': sys.argv[3],
    'head': sys.argv[4],
    'timestamp': sys.argv[5],
    'working_dir': sys.argv[6],
    'duration_seconds': int(sys.argv[7]),
    'exit_code': int(sys.argv[8]),
    'stdout': sys.argv[9],
    'stderr': sys.argv[10]
}
with open(sys.argv[11], 'w') as f:
    json.dump(data, f, indent=2)
EOF

cat "${OUT_FILE}"
if [ -s "${ERR_FILE}" ]; then
  cat "${ERR_FILE}" >&2
fi

exit "${EXIT_CODE}"

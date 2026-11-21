#!/usr/bin/env bash
# .gsd/run_and_record.sh
# Usage: .gsd/run_and_record.sh <STAGE_OR_WINDOW_ID> <STEP_NAME> <COMMAND...>

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

STDOUT_FILE="${EVIDENCE_DIR}/${STEP}.stdout"
STDERR_FILE="${EVIDENCE_DIR}/${STEP}.stderr"
EXIT_FILE="${EVIDENCE_DIR}/${STEP}.exitcode"
META_FILE="${EVIDENCE_DIR}/${STEP}.meta.json"

TMP_ERR="$(mktemp)"

START_TIME="$(date +%s)"
"$@" > "${STDOUT_FILE}" 2> "${TMP_ERR}"
EXIT_CODE=$?
END_TIME="$(date +%s)"
DURATION=$((END_TIME - START_TIME))

mv "${TMP_ERR}" "${STDERR_FILE}"
echo -n "${EXIT_CODE}" > "${EXIT_FILE}"

CMD_STR="$*"
python3 -c "
import json, sys
data = {
    'target': sys.argv[1],
    'step': sys.argv[2],
    'command': sys.argv[3],
    'head': sys.argv[4],
    'timestamp': sys.argv[5],
    'duration_seconds': int(sys.argv[6]),
    'exit_code': int(sys.argv[7])
}
with open(sys.argv[8], 'w') as f:
    json.dump(data, f, indent=2)
" "${TARGET}" "${STEP}" "${CMD_STR}" "${HEAD_REV}" "${STAMP}" "${DURATION}" "${EXIT_CODE}" "${META_FILE}"

cat "${STDOUT_FILE}"
if [ -s "${STDERR_FILE}" ]; then
  cat "${STDERR_FILE}" >&2
fi

exit "${EXIT_CODE}"

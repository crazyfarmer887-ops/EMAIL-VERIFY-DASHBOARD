#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK="${1:?usage: run-fix.sh <task-or-issues>}"
bash "$ROOT/gaslight.sh" context --stage fix --model "${MODEL:-codex}" --mode isolated
printf '
INPUT:
%s
' "$TASK"

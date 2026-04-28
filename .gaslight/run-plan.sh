#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK="${1:?usage: run-plan.sh <task>}"
bash "$ROOT/gaslight.sh" context --stage planning --model "${MODEL:-codex}" --mode isolated
printf '
TASK:
%s
' "$TASK"

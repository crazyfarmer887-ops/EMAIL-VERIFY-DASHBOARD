#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${1:?usage: run-review.sh <file-or-text>}"
bash "$ROOT/gaslight.sh" review "$INPUT"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREPARE_ALL_JS="$SCRIPT_DIR/prepare-gateway-resume-all.js"

REASON="${1:-assistant_requested_restart_all_sessions}"
MAX_AGE_HOURS="${2:-24}"
MAX_CANDIDATES="${3:-12}"
DRY_RUN="${DRY_RUN:-0}"

PREPARE_ARGS=(
  --reason "$REASON"
  --max-age-hours "$MAX_AGE_HOURS"
  --max-candidates "$MAX_CANDIDATES"
)

if [[ "$DRY_RUN" == "1" ]]; then
  PREPARE_ARGS+=(--dry-run)
fi

node "$PREPARE_ALL_JS" "${PREPARE_ARGS[@]}"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1 -> skipping openclaw gateway restart"
  exit 0
fi

openclaw gateway restart

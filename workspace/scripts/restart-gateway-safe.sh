#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREPARE_JS="$SCRIPT_DIR/prepare-gateway-resume.js"

SESSION_KEY="${1:-}"
REASON="${2:-assistant_requested_restart}"
TASK="${3:-Resume the interrupted conversation after gateway restart and continue the latest unfinished user request.}"

if [[ -z "$SESSION_KEY" ]]; then
  echo "Usage: $0 <sessionKey> [reason] [task]" >&2
  exit 1
fi

node "$PREPARE_JS" --session-key "$SESSION_KEY" --reason "$REASON" --task "$TASK"
openclaw gateway restart

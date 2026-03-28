#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OpenClaw V2 — Graceful Gateway Launcher
#
# Starts `openclaw gateway` with the graceful-shutdown preload injected.
# The preload script intercepts SIGTERM/SIGINT and drains in-flight LLM
# tasks before allowing the process to exit.
#
# Usage:
#   ./graceful-gateway.sh                     # Start with defaults
#   ./graceful-gateway.sh --port 18789        # Pass args to openclaw gateway
#   GRACE_PERIOD_MS=60000 ./graceful-gateway.sh   # Custom drain timeout
#
# To restart gracefully:
#   kill -15 $(pgrep -f "openclaw-gateway")   # or: kill -TERM <pid>
#
# Environment:
#   GRACE_PERIOD_MS   Soft drain timeout in ms (default: 30000)
#   HARD_KILL_MS      Hard kill delta (default: 10000)
#   GRACEFUL_LOG      Set to "0" to suppress preload logs
#   OPENCLAW_BIN      Path to openclaw binary (auto-detected)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRELOAD_PATH="${SCRIPT_DIR}/graceful-shutdown-preload.mjs"

# Verify preload script exists
if [[ ! -f "$PRELOAD_PATH" ]]; then
  echo "❌ Preload script not found: $PRELOAD_PATH" >&2
  exit 1
fi

# Resolve openclaw binary
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw 2>/dev/null || echo "")}"
if [[ -z "$OPENCLAW_BIN" ]]; then
  echo "❌ Cannot find 'openclaw' in PATH. Set OPENCLAW_BIN." >&2
  exit 1
fi

# Inject the preload via NODE_OPTIONS --import
# Append to existing NODE_OPTIONS if present (e.g., user may have --max-old-space-size)
export NODE_OPTIONS="${NODE_OPTIONS:-} --import ${PRELOAD_PATH}"

# Export grace period config
export GRACE_PERIOD_MS="${GRACE_PERIOD_MS:-30000}"
export HARD_KILL_MS="${HARD_KILL_MS:-10000}"

echo "🦞 [graceful-gateway] Launching with preload: ${PRELOAD_PATH}"
echo "🦞 [graceful-gateway] Drain budget: ${GRACE_PERIOD_MS}ms soft + ${HARD_KILL_MS}ms hard"
echo "🦞 [graceful-gateway] Binary: ${OPENCLAW_BIN}"
echo ""

# Forward all arguments to openclaw gateway
exec "$OPENCLAW_BIN" gateway "$@"

#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OpenClaw V2 — Graceful Restart Script
#
# Replaces the V1 restart-gateway-safe.sh.
#
# V1 approach: dump memory → kill → hook resumes from file
# V2 approach: SIGTERM → preload drains in-flight tasks → clean exit → auto-restart
#
# Usage:
#   ./restart-gateway-graceful.sh             # Restart via SIGTERM
#   ./restart-gateway-graceful.sh --force     # Fallback: use openclaw gateway restart
#
# Requirements:
#   - Gateway must be started via graceful-gateway.sh (with preload injected)
#   - OR: if started normally, SIGTERM will still work but without drain
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

# Find gateway PID
GATEWAY_PID=$(pgrep -f "openclaw-gateway" 2>/dev/null | head -1 || echo "")

if [[ -z "$GATEWAY_PID" ]]; then
  echo "❌ No running openclaw-gateway process found" >&2

  if $FORCE; then
    echo "🔄 --force: Attempting openclaw gateway restart..."
    openclaw gateway restart
    exit $?
  fi

  exit 1
fi

echo "🦞 [restart] Found gateway PID: $GATEWAY_PID"

# Check if the preload is active (optional, just informational)
if grep -q "graceful-shutdown-preload" /proc/"$GATEWAY_PID"/cmdline 2>/dev/null || \
   grep -q "graceful-shutdown-preload" /proc/"$GATEWAY_PID"/environ 2>/dev/null; then
  echo "🦞 [restart] Graceful preload detected ✓"
  echo "🦞 [restart] Sending SIGTERM — preload will drain in-flight tasks before exit"
else
  echo "⚠️  [restart] Graceful preload NOT detected"
  echo "⚠️  [restart] SIGTERM will still work, but no drain guarantee"
fi

# Send SIGTERM
kill -TERM "$GATEWAY_PID"
echo "🦞 [restart] SIGTERM sent to PID $GATEWAY_PID"

# Wait for the process to exit (max ~45 seconds)
MAX_WAIT=45
WAITED=0
while kill -0 "$GATEWAY_PID" 2>/dev/null; do
  if (( WAITED >= MAX_WAIT )); then
    echo "⚠️  [restart] Process still alive after ${MAX_WAIT}s"
    if $FORCE; then
      echo "🔪 [restart] --force: Sending SIGKILL"
      kill -KILL "$GATEWAY_PID" 2>/dev/null || true
    else
      echo "💡 Tip: Use --force to SIGKILL after timeout"
    fi
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
  echo "🦞 [restart] Gateway process exited cleanly ✓"
  echo "🦞 [restart] Process manager (systemd/pm2) should auto-restart the gateway"
else
  echo "❌ [restart] Gateway still running at PID $GATEWAY_PID" >&2
  exit 1
fi

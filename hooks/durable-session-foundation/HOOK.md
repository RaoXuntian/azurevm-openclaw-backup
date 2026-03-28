---
name: durable-session-foundation
description: "Persist inbound/outbound session state into a local SQLite durable store and mark stale running turns interrupted."
homepage: https://docs.openclaw.ai/automation/hooks
metadata:
  {
    "openclaw": {
      "emoji": "🧱",
      "events": ["gateway:startup", "message:received", "message:sent"],
      "requires": { "bins": ["node"] }
    }
  }
---

# Durable Session Foundation

Runs on:
- `gateway:startup`
- `message:received`
- `message:sent`

Purpose:
- persist inbound user messages into a local SQLite durable store
- persist assistant replies and delivery status into the same store
- deduplicate provider retries when message IDs are available
- track turns with `received` / `running` / `completed` / `interrupted`
- mark stale running turns interrupted on startup and via a lightweight periodic reaper
- reconcile recent transcript tails so crash windows do not silently drop already-written user/assistant messages

Default database path:
- `~/.openclaw/runtime/session-store.sqlite3`

Configuration is read from:
- `hooks.internal.entries.durable-session-foundation`

Supported options:
- `enabled`: boolean
- `dbPath`: string
- `leaseMinutes`: number (default: `30`)
- `sweepIntervalMinutes`: number (default: `5`)
- `reconcileLookbackHours`: number (default: `48`)
- `reconcileTailLines`: number (default: `400`)

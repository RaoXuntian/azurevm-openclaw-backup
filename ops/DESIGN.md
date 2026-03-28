# OpenClaw V2 — Graceful Shutdown/Restart

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Node.js Process                         │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  graceful-shutdown-preload.mjs (--import)         │   │
│  │  • SIGTERM/SIGINT handlers                        │   │
│  │  • Direct access to globalThis queue state        │   │
│  └──────────────┬───────────────────────────────────┘   │
│                 │ shares process space                    │
│  ┌──────────────▼───────────────────────────────────┐   │
│  │  openclaw gateway (core)                          │   │
│  │  • Lane Queue System (globalThis singleton)       │   │
│  │  • agentCommandFromIngress → enqueueCommandInLane │   │
│  │  • HTTP/WS server, plugins, channels              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Shutdown Pipeline

```
SIGTERM received
    │
    ▼
1. markDraining()
   • Sets globalThis[Symbol.for('openclaw.commandQueueState')].gatewayDraining = true
   • New enqueueCommandInLane() calls → reject(GatewayDrainingError)
   • Existing HTTP 503 behavior: channels get standard rejection
    │
    ▼
2. waitForActiveTasks(GRACE_PERIOD_MS)
   • Snapshots currently active task IDs across all lanes
   • Polls every 100ms until all snapshotted tasks complete or timeout
   • Soft drain: default 30s, configurable via GRACE_PERIOD_MS
   • Hard kill: additional HARD_KILL_MS (default 10s) then abandon
    │
    ▼
3. process.exit(0)
   • Node.js runs 'exit' handlers (gateway's own cleanup)
   • SQLite WAL checkpoint happens via normal db.close()
   • Process manager (systemd/pm2) auto-restarts new instance
```

## Files

| File | Purpose |
|------|---------|
| `graceful-shutdown-preload.mjs` | ESM preload — installs SIGTERM handler, accesses Lane Queue via globalThis |
| `graceful-gateway.sh` | Launcher — starts `openclaw gateway` with `NODE_OPTIONS="--import ..."` |
| `restart-gateway-graceful.sh` | Restart — sends SIGTERM, waits for clean exit, replaces V1 scripts |
| `DESIGN.md` | This file |

## Why Preload, Not Wrapper?

The Lane Queue state (`markGatewayDraining`, `waitForActiveTasks`) lives on
`globalThis` inside the gateway process. An external wrapper process spawning
a child CANNOT access this state — JavaScript processes don't share memory.

Node's `--import` flag lets us inject code that runs **inside** the same
process as the gateway, sharing `globalThis`. This is the only non-invasive
way to access the internal queue state without modifying openclaw source code.

## Key Insight: globalThis Singleton

OpenClaw stores the command queue state as a global singleton:

```js
const COMMAND_QUEUE_STATE_KEY = Symbol.for('openclaw.commandQueueState');
// Symbol.for() is cross-module — any code in the same process can access it
globalThis[COMMAND_QUEUE_STATE_KEY] = {
  gatewayDraining: false,
  lanes: new Map(),
  nextTaskId: 1
};
```

Our preload accesses this directly — no need to resolve minified export aliases.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `GRACE_PERIOD_MS` | `30000` | Soft drain timeout (ms) |
| `HARD_KILL_MS` | `10000` | Additional hard kill budget (ms) |
| `GRACEFUL_LOG` | (enabled) | Set to `"0"` to suppress preload logs |

## PM2 Configuration

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'openclaw-gateway',
    script: '/path/to/graceful-gateway.sh',
    args: '--port 18789',
    kill_timeout: 45000,  // Must be > GRACE_PERIOD_MS + HARD_KILL_MS
    listen_timeout: 10000,
  }]
};
```

## V1 Deprecation

The following V1 artifacts are superseded by this system:

- `scripts/restart-gateway-safe.sh` → replaced by `restart-gateway-graceful.sh`
- `scripts/prepare-gateway-resume.js` → **deprecated** (no longer needed)
- `scripts/prepare-gateway-resume-all.js` → **deprecated**
- `hooks/resume-after-restart/` → **deprecated** (SQLite WAL handles context persistence)
- `runtime/pending-resume.d/` → **deprecated** (no more file-based state transfer)

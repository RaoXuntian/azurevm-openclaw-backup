# Restart Resume PoC

Goal: reduce task interruption when the assistant intentionally restarts the gateway.

## Important status note

This document describes the **current V1 continuity layer**, not the final durability architecture.

It helps with:
- planned maintenance
- deliberate gateway restarts triggered through helper wrappers
- best-effort continuation of sessions that look unfinished

It does **not** make the gateway fully stateless or crash-proof by itself.

The intended V2 direction is documented in:
- `workspace/docs/openclaw-v2-roadmap.md`

---

## Scope of this PoC

Current scope:
- current session
- direct chat sessions (especially `openclaw-weixin`)
- **all recently updated user-facing sessions** that look unfinished at pre-restart scan time
- deliberate restarts initiated through the helper wrappers

Still not covered automatically:
- arbitrary restarts triggered outside these wrappers
- literal hidden model reasoning state (cannot be preserved across process restart)
- long-idle / stale sessions outside the recency window unless explicitly forced
- clearly completed sessions (intentionally skipped by the scanner)
- full crash-safe continuity for turns that were never durably persisted before failure

## How it works

1. Before restart, write pending resume task(s) into:
   - `workspace/runtime/pending-resume.d/*.json`
2. Existing `resume-after-restart` startup hook will:
   - pick up each pending task
   - resume it in a hidden recovery session
   - deliver the final result back into the original session flow
3. For Weixin direct chats, the scanner records `reply.channel/to/accountId` when available so the hook can deliver the reply back through the channel.
4. For channels without direct delivery support, the hook mirrors the final reply back into the original session transcript.

## Helper scripts

### 1. Create a pending resume task for one session only
```bash
node /home/xtrao/.openclaw/workspace/scripts/prepare-gateway-resume.js \
  --session-key 'agent:main:main' \
  --reason 'manual gateway restart' \
  --task 'Resume the interrupted conversation after gateway restart and continue the latest unfinished user request.'
```

### 2. Create the task for one session and restart gateway
```bash
bash /home/xtrao/.openclaw/workspace/scripts/restart-gateway-safe.sh \
  'agent:main:main' \
  'manual gateway restart' \
  'Resume the interrupted conversation after gateway restart and continue the latest unfinished user request.'
```

### 3. Scan all relevant sessions and create pending tasks
```bash
node /home/xtrao/.openclaw/workspace/scripts/prepare-gateway-resume-all.js \
  --reason 'manual gateway restart' \
  --max-age-hours 24 \
  --max-candidates 12
```

Useful flags:
- `--dry-run` → print the scan result without writing task files
- `--ignore-existing-pending` → validation aid; do not suppress sessions just because a pending task already exists
- `--include-session-key <key>` → force-include a specific session key for inspection / testing

### 4. Scan all relevant sessions, create pending tasks, then restart gateway
```bash
bash /home/xtrao/.openclaw/workspace/scripts/restart-gateway-safe-all.sh \
  'manual gateway restart' \
  24 \
  12
```

Set `DRY_RUN=1` on the wrapper if you want to verify the pre-restart scan without actually restarting:
```bash
DRY_RUN=1 bash /home/xtrao/.openclaw/workspace/scripts/restart-gateway-safe-all.sh \
  'manual gateway restart' \
  24 \
  12
```

## All-session scanner heuristics

The all-session scanner is intentionally conservative.

It **includes** sessions only when all of the following are true:
- session is user-facing (has a real provider / delivery channel / chat type)
- session is recent enough (default: updated within the last 24 hours)
- session is not a hidden/internal session
- there is not already an active pending resume task for that session
- transcript tail suggests the latest user request is unfinished

Transcript-tail signals treated as likely unfinished:
- last relevant message is a **user** message
- last relevant message is a **toolResult** and no later assistant text exists
- last relevant message is an **assistant thinking-only** message with no visible final text
- `abortedLastRun=true`

It **skips** sessions when:
- the latest user message already has a visible assistant text reply
- the session is a hidden resume / subagent / cron session
- the session is older than the recency window
- the transcript is missing / unreadable
- a pending task already exists

This means false negatives are preferred over false positives: better to miss a borderline session than to resume one that was already clearly done.

## Expected behavior

- current session disconnects briefly during restart
- after gateway startup, each selected session is resumed in a hidden recovery session
- the final reply is mirrored or delivered back to the original session
- hidden resume sessions themselves are never re-queued by the pre-restart scanner

## Limitations

- This remains a PoC; the “unfinished” decision is heuristic.
- It depends on using the helper before restarting.
- It reconstructs continuity from transcript history, not live in-memory reasoning state.
- It currently only captures direct channel reply metadata for channels where it is already known how to send directly (`openclaw-weixin`).
- Recent-but-completed sessions may still be scanned, but the current heuristics are designed to avoid scheduling them unless the transcript tail looks genuinely incomplete.
- It should be treated as a **fallback continuity mechanism** until V2 durable turn storage exists.

## Position in the V2 roadmap

In the target V2 architecture:
- user/assistant turns are durably stored as they happen
- restart-resume is no longer the primary continuity layer
- `pending-resume.d` remains useful for planned maintenance and explicit recovery workflows

Short version:
- V1 PoC = good for controlled restarts
- V2 architecture = required for real crash tolerance

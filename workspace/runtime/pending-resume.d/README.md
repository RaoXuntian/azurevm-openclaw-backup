# pending-resume.d

Per-session gateway-restart recovery tasks live here.

## Status note

This directory represents the **current V1 planned-restart recovery mechanism**.
It is useful, but it is **not** the same thing as a fully durable, stateless session store.

In the intended V2 architecture:
- session continuity should come primarily from durable message/turn storage
- this directory should remain a fallback queue for planned maintenance and explicit recovery tasks

See:
- `workspace/docs/restart-resume-poc.md`
- `workspace/docs/openclaw-v2-roadmap.md`

## Task format

Each file is a JSON object. Minimum fields for a resumable task:

```json
{
  "id": "optional-task-id",
  "active": true,
  "status": "pending",
  "resumeAfterGatewayRestart": true,
  "sessionKey": "agent:main:main",
  "task": "short description",
  "steps": ["step 1", "step 2"],
  "notes": ["optional note"],
  "reply": {
    "channel": "openclaw-weixin",
    "accountId": "...",
    "to": "..."
  }
}
```

Terminal states written back by the resume hook / hidden recovery session:
- `status: "completed"` + `active: false`
- `status: "failed"` + `active: false`
- `lastResult`
- `completedAt` or `failedAt`

For channels without a direct reply implementation, the hook will try to mirror a real assistant reply back into the original `sessionKey` transcript and emit a transcript update, so the visible session receives a normal assistant message instead of a raw system follow-up.

## How tasks get here

Single-session helper:
- `scripts/prepare-gateway-resume.js`
- `scripts/restart-gateway-safe.sh`

All-session helper:
- `scripts/prepare-gateway-resume-all.js`
- `scripts/restart-gateway-safe-all.sh`

## All-session scanner rules

The all-session helper is conservative by design.

It skips:
- hidden recovery sessions (`agent:<agentId>:resume:*`)
- subagent sessions
- cron sessions / cron run sessions
- sessions older than the configured recency window (default 24h)
- sessions whose latest user turn already has a visible assistant text reply
- sessions that already have an active pending task

It prefers sessions that were updated recently and whose transcript tail looks incomplete, for example:
- tail is a user message
- tail is a tool result with no later assistant text
- tail is an assistant thinking-only message without visible final text
- store metadata says `abortedLastRun=true`

When available, direct reply metadata is preserved in the task payload so `resume-after-restart` can reply through the original channel instead of only mirroring into the transcript.

## Practical guidance

Use this mechanism when:
- you are about to do a controlled restart
- you want best-effort continuation for unfinished sessions
- you need reply metadata to survive a bounce

Do not mistake it for:
- a durable primary transcript store
- a guarantee against sudden power loss / OOM / `kill -9`
- a substitute for V2 storage-backed continuity

# pending-resume.d

Per-session gateway-restart recovery tasks live here.

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

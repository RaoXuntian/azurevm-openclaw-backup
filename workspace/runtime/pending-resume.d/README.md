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

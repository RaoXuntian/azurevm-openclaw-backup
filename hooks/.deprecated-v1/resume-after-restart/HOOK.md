---
name: resume-after-restart
description: "After gateway restart, resume pending per-session tasks in hidden recovery sessions, then deliver the result back to the original session or reply target."
homepage: https://docs.openclaw.ai/automation/hooks
metadata:
  {
    "openclaw": {
      "emoji": "🔁",
      "events": ["gateway:startup"],
      "requires": { "bins": ["node"] }
    }
  }
---

# Resume After Restart

Runs on `gateway:startup`.

Purpose:
- scan `runtime/pending-resume.d/*.json` (plus legacy `runtime/pending-resume.json`)
- resume each `active=true` + `status=pending` + `resumeAfterGatewayRestart=true` task in a **hidden recovery session**
- avoid polluting the user's main session with BOOT / recovery prompts
- write terminal status back into the same task file
- deliver the final result by either:
  - sending to the recorded `reply` target (currently `openclaw-weixin` supported)
  - or mirroring a real assistant reply back into the original `sessionKey` transcript and emitting a transcript update

This hook is the new resume engine.
`boot-md` should stay disabled so startup recovery no longer injects BOOT text into the visible session.

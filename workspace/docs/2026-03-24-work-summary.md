# 2026-03-24 Work Summary

## 1. VM monitor dashboard

### Delivered
- Built and tested local repo:
  - `vm-monitor-dashboard`
- Local deployment completed:
  - systemd service for dashboard backend
  - Caddy reverse proxy on public HTTP
  - Basic Auth added
- GitHub backup completed:
  - `RaoXuntian/vm-monitor-dashboard`

### Current access
- Public URL uses the VM public IP over HTTP
- Protected by Basic Auth

## 2. GitHub backup discipline

### Delivered
- Private machine backup repo created and used:
  - `RaoXuntian/azurevm-openclaw-backup`
- Expanded README
- Added:
  - `workspace/scripts/patch-openclaw-weixin.sh`
  - `workspace/docs/openclaw-safe-upgrade-sop.md`
  - `workspace/docs/backup-strategy.md`

### Outcome
- Backup workflow is now documented and in active use.

## 3. openclaw-weixin compatibility repair

### Problem
- After OpenClaw upgrades, `openclaw-weixin` repeatedly broke with SDK import drift such as:
  - `Cannot find module 'openclaw/plugin-sdk'`
  - missing old SDK exports from root path

### Delivered
- Repaired the live extension by:
  - restoring local `openclaw` module resolution inside the extension
  - patching old SDK imports to newer subpaths
- Added reusable patch script:
  - `workspace/scripts/patch-openclaw-weixin.sh`
- Added safe upgrade SOP to reduce future downtime:
  - `workspace/docs/openclaw-safe-upgrade-sop.md`

### Important lesson
- Do not mutate the live global OpenClaw runtime with `npm install -g` during active service hours unless a maintenance window is accepted.

## 4. Weixin availability / multi-account cleanup

### Problems encountered
- Multiple stale Weixin accounts were mixed together
- QR login success did not always immediately produce active polling
- Gateway restart could leave Weixin channels in `no running` until the next health-monitor cycle

### Delivered
- Backed up and reset Weixin account state
- Re-logged a clean Weixin account state
- Updated cron jobs to newer Weixin account IDs where applicable
- Identified and fixed the delayed auto-start root cause:
  - `channels.openclaw-weixin` was missing from `openclaw.json`
  - after adding it, restart behavior now actively restarts the Weixin channel instead of waiting ~10 minutes for health-monitor

### Current config state
- `channels.openclaw-weixin: {}` present
- `plugins.entries.openclaw-weixin.enabled: true`
- `hooks.internal.entries.boot-md.enabled: false`
- `hooks.internal.entries.resume-after-restart.enabled: true`

## 5. Restart resume work

### Delivered
- Existing `resume-after-restart` system was reviewed and extended
- Added helper scripts:
  - `workspace/scripts/prepare-gateway-resume.js`
  - `workspace/scripts/restart-gateway-safe.sh`
  - `workspace/scripts/prepare-gateway-resume-all.js`
  - `workspace/scripts/restart-gateway-safe-all.sh`
- Updated docs:
  - `workspace/docs/restart-resume-poc.md`
  - `workspace/runtime/pending-resume.d/README.md`
- Added all-session scanner heuristics for conservative candidate detection before restart

### Current status
- **Not fully closed yet**
- Current/direct/all-session resume work has been partially implemented, but the restart-resume flow still needs final validation and cleanup.
- Main known issue during testing:
  - internal recovery prompts were still leaking into the visible session in some restart tests
  - the newest hidden-session + mirror rewrite was implemented, but should be treated as **work in progress until revalidated**

## 6. Recommended next steps

1. Re-validate `resume-after-restart` after the latest hidden-session + mirror rewrite
2. Backup the final validated resume implementation again after it passes live testing
3. Optionally add HTTPS to `vm-monitor-dashboard`
4. Keep using the private backup repo for milestone pushes

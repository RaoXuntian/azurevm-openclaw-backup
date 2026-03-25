# Backup Strategy

Purpose: make backups habitual, low-friction, and safe.

---

## Core principle

**Important work should become a git commit quickly, and important infrastructure changes should reach a private GitHub repo soon after.**

Backup is not a special ceremony. It is part of finishing work.

---

## What to back up

### A. Project repos (full code history)
Use a dedicated repo when work has its own lifecycle.

Examples:
- `vm-monitor-dashboard`
- future apps / dashboards / tools
- substantial automation or scripts with their own README

Back up:
- source code
- README
- package files / lockfiles
- deploy notes
- non-secret example config

Do **not** back up:
- live `.env`
- secrets
- tokens
- machine-specific auth material

### B. Machine / assistant backup repo (sanitized)
Use the private backup repo for cross-cutting machine state.

Current repo:
- `azurevm-openclaw-backup`

Back up here:
- workspace core docs
- custom hooks
- custom skills
- redacted config snapshots
- operational SOPs
- patch scripts

Do **not** put full live machine state here.

### C. One-off emergency backups
Before risky changes, create a local timestamped backup copy first.

Examples:
- config before editing
- session store before cleanup
- account files before pruning

Pattern:
- keep local rollback copy
- then perform the change
- then commit/push the durable version if the result is good

---

## Default trigger rules

A backup action should happen automatically after any of these:

### Trigger 1: New repo created
Action:
- `git init`
- first commit as soon as the project runs or has a meaningful skeleton
- push to GitHub when the user wants it public/private

### Trigger 2: Prototype becomes runnable
Action:
- commit immediately
- if useful beyond this session, push to GitHub

### Trigger 3: Production incident fixed
Action:
- document root cause
- commit/push:
  - patch scripts
  - SOP
  - changed hook/plugin files

### Trigger 4: New reusable script/tool added
Action:
- commit to the relevant repo or backup repo

### Trigger 5: Important config or routing logic changed
Action:
- store redacted snapshot
- commit to backup repo

### Trigger 6: End of a high-value work block
Examples:
- dashboard shipped
- integration repaired
- cron jobs stabilized
- deployment working

Action:
- ask: “Is this now valuable enough that losing it would be annoying?”
- if yes, commit now

---

## Commit / push policy

### Commit locally when:
- a coherent unit of work is done
- the current state is better than the previous one
- rollback would matter

### Push to GitHub when:
- the work is reusable
- the machine is now relying on it
- the fix matters operationally
- the user may want it later on another machine

### Recommended habit
- **commit early**
- **push after milestones**
- do not wait until “fully perfect”

---

## Redaction rules

Before pushing anything machine-level, remove or replace:

- API keys
- passwords
- bearer tokens
- cookies
- `.env`
- device identity
- pairing files
- approval files
- raw account auth blobs
- personal/private memory files unless explicitly requested

Prefer:
- `openclaw.redacted.json`
- `.env.example`
- `README` notes explaining what must be recreated manually

---

## Backup tiers

### Tier 1 — Local rollback copy
Use before risky edits.

Examples:
- `*.backup-YYYYMMDD-HHMMSS`
- copied JSON before cleanup

### Tier 2 — Local git commit
Use when work reaches a meaningful checkpoint.

### Tier 3 — Remote GitHub push
Use when the result is important enough to preserve off-machine.

---

## Naming guidance

### Repos
- use plain, durable names
- prefer purpose over cleverness

Examples:
- `vm-monitor-dashboard`
- `azurevm-openclaw-backup`

### Backup files
- include date/time if local rollback only
- avoid timestamped variants for canonical memory files

---

## Operational checklist

### Before risky change
- [ ] identify what can break
- [ ] create local rollback copy
- [ ] decide whether service availability matters right now
- [ ] avoid live runtime mutation if a smaller patch will work

### After successful fix/build
- [ ] commit locally
- [ ] update README/SOP if future-you could get confused
- [ ] push to GitHub if the result is operationally important

### After incident
- [ ] write postmortem
- [ ] add patch or SOP
- [ ] back up the fix, not just the memory of it

---

## Default assistant behavior going forward

Unless the user says otherwise:

1. New substantial repo → initialize git early.
2. Working prototype → commit.
3. Important infra fix → document + commit.
4. Important machine-level change → update private backup repo.
5. If a GitHub repo already exists, prefer pushing milestone fixes instead of leaving them only local.
6. Follow `skills/git-workflow/SKILL.md`: feature branches, PRs, cross-model review, human approval before merge.

---

## What counts as “important enough to back up”

If losing it would cost more than 10–15 minutes to recreate, it probably deserves a commit.

If losing it would be painful, confusing, or risky, it probably deserves a push.

---

## Current repos to maintain

### Private backup repo
- `RaoXuntian/azurevm-openclaw-backup`

### Project repos
- `RaoXuntian/vm-monitor-dashboard`

Add new repos here as they appear.

---

## Short version

- backup earlier
- backup more often
- sanitize before pushing
- treat docs/SOPs/scripts as first-class assets
- do not leave important fixes only in chat history

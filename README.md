# azurevm-openclaw-backup

Private, sanitized backup of selected OpenClaw files from `azurevm`.

This repository preserves the parts of the machine that are most useful to rebuild, debug, or evolve the current OpenClaw setup, without exposing live secrets.

It now serves **two roles**:
- a sanitized backup / restore aid for the current system
- a design and operations record for the next OpenClaw iteration

## What this backup is for

Use this repo to:
- preserve custom OpenClaw skills and local workflow logic
- keep a redacted copy of important config structure
- save current operational recovery mechanisms and incident-response scripts
- document the workspace shape and assistant setup
- track architecture decisions for the next durability / low-cost retrieval upgrade

Use it as a **reference / restore aid**, not as a full machine image.

## Current state vs target state

### Current state preserved here
This repo currently captures a **V1 operational continuity layer**:
- redacted config
- custom skills
- `openclaw-weixin` compatibility fixes
- safe upgrade SOPs
- a `restart-resume` proof of concept for controlled gateway restarts

### Target state being documented here
The intended V2 direction is:
- lower-cost information retrieval via RSS, browser automation, and local code execution
- durable session continuity backed by storage instead of in-memory-only runtime state
- keeping the current restart-resume flow as a fallback, not the primary safety mechanism

See:
- `workspace/docs/openclaw-v2-roadmap.md`
- `workspace/docs/openclaw-v2-24h-sprint.md`
- `workspace/docs/openclaw-v2-implementation-checklist.md`
- `workspace/docs/restart-resume-poc.md`

## Included

### Workspace core files
Stored under `workspace/`:
- `AGENTS.md`
- `BOOT.md`
- `HEARTBEAT.md`
- `IDENTITY.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`

### Operational docs and SOPs
Stored under `workspace/docs/`:
- `2026-03-24-work-summary.md`
- `backup-strategy.md`
- `openclaw-safe-upgrade-sop.md`
- `restart-resume-poc.md`
- `openclaw-v2-roadmap.md`

### Custom restart-resume hook (V1 continuity layer)
Stored under:
- `workspace/hooks/resume-after-restart/HOOK.md`
- `workspace/hooks/resume-after-restart/handler.js`

### Runtime reference
Stored under:
- `workspace/runtime/pending-resume.d/README.md`

### Custom skills
Stored under `skills/`:
- `daily-stock-analysis/`
- `no-card-search/`

### Redacted config snapshot
Stored under:
- `config/openclaw.redacted.json`

This file keeps the structure of the live OpenClaw config while removing sensitive values.

### Patched extension reference
Stored under `extensions/`:
- `openclaw-weixin/`

This preserves the locally repaired extension state used to recover from OpenClaw SDK drift.

## Excluded on purpose

This repo does **not** include:
- `memory/` and personal daily notes
- `.env` files
- raw API keys, passwords, tokens, or cookies
- device identity / pairing / approval state
- pending devices / auth materials
- full source workspace git history
- unredacted `openclaw.json`

## Repository layout

```text
.
├── README.md
├── config/
│   └── openclaw.redacted.json
├── extensions/
│   └── openclaw-weixin/
├── skills/
│   ├── daily-stock-analysis/
│   └── no-card-search/
└── workspace/
    ├── AGENTS.md
    ├── BOOT.md
    ├── HEARTBEAT.md
    ├── IDENTITY.md
    ├── SOUL.md
    ├── TOOLS.md
    ├── USER.md
    ├── docs/
    ├── hooks/
    │   └── resume-after-restart/
    ├── runtime/
    │   └── pending-resume.d/
    └── scripts/
```

## Restore notes

If rebuilding on another machine, treat this repo as a guide:

1. Restore files into the matching OpenClaw directories.
2. Recreate secrets manually (`.env`, tokens, API keys, device identity).
3. Compare the target machine's live config against `config/openclaw.redacted.json`.
4. Reinstall any required runtimes / CLIs used by the skills.
5. Test custom hooks, scripts, and extensions before relying on them in production.

## Notable custom work preserved here

### `no-card-search`
A no-credit-card fallback search skill that combines:
- Bing RSS web search
- Google News RSS
- official RSS feeds for selected media
- Wikipedia OpenSearch
- arXiv API
- bilingual global news brief generation

### `daily-stock-analysis`
An OpenClaw wrapper skill around the local stock analysis system.

### `resume-after-restart`
A V1 recovery flow for gateway restarts that:
- avoids polluting the visible session with BOOT noise
- resumes pending tasks in hidden recovery sessions
- mirrors recovery results back into the original session

Important: this is **not** the final durability architecture. It is a controlled-restart recovery layer, not a full replacement for storage-backed session continuity.

### `patch-openclaw-weixin.sh`
A reusable patch script to repair extension compatibility after OpenClaw upgrades when SDK import paths drift.

### `openclaw-v2-roadmap.md`
A forward-looking design document covering:
- low-cost retrieval strategy
- browser/code/RSS/RAG capability roadmap
- durable session storage direction
- transition away from restart-only recovery heuristics

## Updating this backup

Recommended workflow for future updates:

1. Update the local staging repo at:
   - `/home/xtrao/.openclaw/backup-staging/azurevm-openclaw-backup`
2. Review for secrets before committing.
3. Commit locally.
4. Push to this private GitHub repo when the milestone is worth preserving remotely.

## Security note

This repo is private, but still assume anything pushed here may eventually be inspected by humans or automation.
Do not store live secrets here unless you intentionally choose to do so.

# azurevm-openclaw-backup

Private, sanitized backup of selected OpenClaw files from `azurevm`.

This repository is meant to preserve the parts of the machine that are most useful to rebuild or understand the current OpenClaw setup, without exposing live secrets.

## What this backup is for

Use this repo to:
- preserve custom OpenClaw skills and local workflow logic
- keep a redacted copy of important config structure
- save the custom gateway restart/resume mechanism
- document the current workspace shape and assistant setup

Use it as a **reference / restore aid**, not as a full machine image.

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

### Custom restart-resume hook
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
    ├── hooks/
    │   └── resume-after-restart/
    └── runtime/
        └── pending-resume.d/
```

## Restore notes

If rebuilding on another machine, treat this repo as a guide:

1. Restore files into the matching OpenClaw directories.
2. Recreate secrets manually (`.env`, tokens, API keys, device identity).
3. Compare the target machine's live config against `config/openclaw.redacted.json`.
4. Reinstall any required runtimes / CLIs used by the skills.
5. Test custom hooks and skills before relying on them in production.

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
A custom recovery flow for gateway restarts that:
- avoids polluting the visible session with BOOT noise
- resumes pending tasks in hidden recovery sessions
- mirrors recovery results back into the original session

## Updating this backup

Recommended workflow for future updates:

1. Update the local staging repo at:
   - `/home/xtrao/.openclaw/backup-staging/azurevm-openclaw-backup`
2. Review for secrets before committing.
3. Commit locally.
4. Push to this private GitHub repo.

## Security note

This repo is private, but still assume anything pushed here may eventually be inspected by humans or automation.
Do not store live secrets here unless you intentionally choose to do so.

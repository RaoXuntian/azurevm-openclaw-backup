# azurevm-openclaw-backup

Private backup of the OpenClaw deployment on `azurevm`.

This repo preserves the files needed to rebuild, debug, or evolve the current setup — without exposing live secrets.

## What this repo is for

- Preserve custom skills (shared and per-agent)
- Keep a redacted copy of config structure
- Save operational scripts and recovery mechanisms
- Document workspace shape and assistant setup for each agent
- Track architecture decisions and SOPs

Use it as a **reference and restore aid**, not as a full machine image.

## Repository layout

```text
.
├── README.md
├── config/
│   └── openclaw.redacted.json        # Redacted config (structure only, no secrets)
├── extensions/
│   └── openclaw-weixin/              # Locally patched Weixin plugin source
├── memory/                           # Selected memory/daily-note snapshots
├── skills/                           # Shared skills (available to all agents)
│   ├── daily-stock-analysis/
│   ├── git-workflow/                  # Git conventions, PR flow, cross-model review
│   └── no-card-search/               # Fallback web search without paid API
├── workspace/                        # Main agent (id: main) workspace snapshot
│   ├── AGENTS.md, SOUL.md, USER.md, ...
│   ├── docs/                         # SOPs, roadmaps, summaries
│   ├── hooks/                        # Custom hooks (resume-after-restart)
│   ├── runtime/                      # Runtime reference (pending-resume format)
│   └── scripts/                      # Operational scripts
└── workspace-coding/                 # Coding agent (id: coding) workspace snapshot
    ├── AGENTS.md, SOUL.md, USER.md, ...
    └── skills/
        └── ui-ux-pro-max/            # UI/UX design intelligence skill
```

## Agents

| Agent ID | Model | Workspace | Purpose |
|----------|-------|-----------|---------|
| `main` | `github-copilot/gpt-5.4` | `workspace/` | General assistant, daily operations |
| `coding` | `github-copilot/claude-opus-4.6` | `workspace-coding/` | Code writing, UI/UX design |

## Shared skills (`skills/`)

These are installed at `~/.openclaw/skills/` on the host and available to **all agents**.

| Skill | Description |
|-------|-------------|
| `git-workflow` | Conventional commits, PR-based merge flow, cross-model code review, branch naming |
| `no-card-search` | Fallback web/news search via Bing RSS, Google News, Wikipedia, arXiv (no paid API needed) |
| `daily-stock-analysis` | Wrapper skill for the local A-share/HK/US stock analysis system |

## Per-agent skills

| Agent | Skill | Description |
|-------|-------|-------------|
| `coding` | `ui-ux-pro-max` | Design intelligence: 67 UI styles, 161 color palettes, 57 font pairings, design system generation. Adapted from [upstream repo](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). |

## Operational docs (`workspace/docs/`)

| File | Content |
|------|---------|
| `backup-strategy.md` | Backup workflow and conventions |
| `openclaw-safe-upgrade-sop.md` | Safe upgrade procedure to avoid service disruption |
| `restart-resume-poc.md` | V1 restart-resume recovery mechanism design |
| `openclaw-v2-roadmap.md` | V2 architecture direction (durable sessions, low-cost retrieval) |
| `openclaw-v2-24h-sprint.md` | Sprint plan for V2 implementation |
| `openclaw-v2-implementation-checklist.md` | Detailed V2 implementation checklist |
| `2026-03-24-work-summary.md` | Work summary for 2026-03-24 |

## Operational scripts (`workspace/scripts/`)

| Script | Purpose |
|--------|---------|
| `patch-openclaw-weixin.sh` | Repair Weixin plugin after OpenClaw upgrades when SDK paths drift |
| `prepare-gateway-resume.js` | Prepare a single session for gateway restart recovery |
| `prepare-gateway-resume-all.js` | Scan all sessions and prepare recovery tasks |
| `restart-gateway-safe.sh` | Safe gateway restart with resume preparation |
| `restart-gateway-safe-all.sh` | Safe gateway restart covering all active sessions |

## Restore guide

1. Copy files into the matching OpenClaw directories on the target machine.
2. Recreate secrets manually (`.env`, tokens, API keys, device identity).
3. Compare the target machine's live config against `config/openclaw.redacted.json`.
4. Recreate agents via `openclaw agents add` if needed (see Agents table above).
5. Install shared skills to `~/.openclaw/skills/`, per-agent skills to each workspace's `skills/`.
6. Reinstall required runtimes/CLIs (Python 3, `gh`, etc.).
7. Test hooks, scripts, and extensions before relying on them in production.

## Excluded on purpose

- `memory/` daily notes (only selected snapshots included)
- `.env` files, raw API keys, passwords, tokens, cookies
- Device identity, pairing, and approval state
- Full workspace git history
- Unredacted `openclaw.json`

## Git workflow

This repo follows the conventions defined in `skills/git-workflow/SKILL.md`:

- **Conventional commits:** `type(scope): subject`
- **Feature branches + PR:** Never push directly to `main`
- **Cross-model code review:** PR author and reviewer use different models
- **Human approval required:** Agents do not merge their own PRs
- **Committer identity:** Set to model name (e.g. `claude-opus-4.6`)

## Security note

This repo is private, but assume anything pushed here may eventually be inspected.
Do not store live secrets here.

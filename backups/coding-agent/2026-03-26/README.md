# coding agent backup snapshot (2026-03-26)

This backup captures the work created for the new isolated OpenClaw agent `coding`.

## What is included
- `workspace-coding/` bootstrap/persona files
- adapted local skill snapshot: `workspace-coding/skills/ui-ux-pro-max/`
- upstream reminder inside `workspace-coding/skills/ui-ux-pro-max/OPENCLAW-INSTALL.md`

## Live runtime details at backup time
- agent id: `coding`
- live workspace: `/home/xtrao/.openclaw/workspace-coding`
- model: `github-copilot/claude-opus-4.6`
- upstream skill repo: `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill`

## Notes
- The live OpenClaw gateway config change that created the `coding` agent is stored in `~/.openclaw/openclaw.json` on the host.
- That raw config file is not copied here because it may contain secrets.
- The `ui-ux-pro-max` installation in this backup is an OpenClaw-local adaptation of the upstream repo, not an official OpenClaw-native package.

## Basic restore idea
1. Restore `workspace-coding/` into `/home/xtrao/.openclaw/workspace-coding`
2. Recreate or verify the `coding` agent entry in OpenClaw config
3. Confirm the model is `github-copilot/claude-opus-4.6`
4. Restart the gateway if needed so the agent is loaded

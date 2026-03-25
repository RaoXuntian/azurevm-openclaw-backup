# MEMORY.md

## User preferences
- Prefers Chinese or English; do not use any fixed name or form of address.
- Prefers shorter, more direct, conclusion-first replies.
- For search/news tasks, if native `web_search` is rate-limited (429), prioritize the custom `no-card-search` fallback skill.
- Avoid heavy-handed actions like unnecessary gateway restarts.

## Environment / access
- OpenClaw Gateway was switched to Tailscale Funnel mode for public HTTPS access on 2026-03-22.
- Public URL: `https://azurevm.tail65b682.ts.net`
- Control UI device pairing is used as an extra approval layer; the user's iPhone browser was manually approved once and should bypass future pairing.
- Pending device approvals are stored in `/home/xtrao/.openclaw/devices/pending.json`; approved devices in `/home/xtrao/.openclaw/devices/paired.json`.

## Installed / configured skills and tools
- `clawhub` CLI installed globally (`clawhub v0.8.0`).
- Third-party skills installed in workspace include `gemini`, `github`, and `xurl`.
- `daily-stock-analysis` was set up as a wrapper skill around an external Python system at `~/.openclaw/skills/daily-stock-analysis/SKILL.md`.
- `no-card-search` skill loading was fixed on 2026-03-24 by changing the YAML `description` in both copies of `SKILL.md` to a block scalar so `site:example.com` no longer breaks parsing.

## OpenClaw / Weixin operational lessons
- Do not run `npm install -g` or otherwise mutate the live global OpenClaw install in place on a production host during active use unless there is an explicit maintenance window.
- For production repairs, prefer: read-only diagnosis → local plugin/extension patch → clear impact warning if reinstall is unavoidable → one controlled restart with rollback path → smoke tests after restart.
- For OpenClaw + Weixin, keep a reusable compatibility patch/script, verify with `openclaw status`, and avoid repeated rescans/restarts during incident response.
- Direct chats in `openclaw-weixin` are scoped by agent + channel + account + peer, so different WeChat accounts/contacts do not share the same short-term session.

## Recent product / project context
- `vm-monitor-dashboard` V2.0 was discussed and described in session history as completed and pushed, including Bento Box UI, SSE streaming, service status actions, traffic tracking, and TCP connection stats. Repository mentioned: `RaoXuntian/vm-monitor-dashboard`.
- A GitHub PAT previously expired; user later provided a new PAT and a push succeeded. Any future token should be treated as sensitive and ideally revoked after use.

## Notable decisions
- User looked into iMessage channel setup but decided it was too complex and not worth doing for now.

# OpenClaw V2 Roadmap

Subtitle: low-cost retrieval stack + durable session architecture

---

## Why this exists

This document turns the current backup repo from a passive snapshot into an actionable V2 roadmap.

The repo currently preserves:
- V1 operational recovery work (`restart-resume` / `pending-resume.d`)
- live incident fixes and upgrade SOPs
- custom low-cost search skill work (`no-card-search`)
- redacted config and workspace state

What it does **not** yet represent is a fully durable, stateless gateway architecture.

This roadmap captures the intended next step.

---

## 1. Background

OpenClaw is currently constrained in two ways:

### A. Search/API cost pressure
A large share of budget is already consumed by LLM token spend.
Buying premium search APIs for every search-style task is not attractive.

### B. Session durability is still incomplete
The current Ubuntu gateway has a useful V1 workaround for planned restarts:
- pre-restart scan helpers
- `pending-resume.d`
- `resume-after-restart`

That flow helps during **controlled** maintenance, but it does **not** make the runtime truly crash-safe.
An unexpected `kill -9`, OOM, host reboot, or runtime failure can still leave session continuity dependent on whatever was or was not already persisted.

---

## 2. V2 goals

### Goal 1 — Lower information-acquisition cost
Prefer free/public data sources, browser automation, and local execution before paying for commercial search APIs.

### Goal 2 — Make session continuity durable
Move from restart-time recovery heuristics toward a storage-backed conversation model that survives process death.

### Goal 3 — Keep the design realistic for a single Azure VM
Avoid introducing unnecessary operational complexity when a simpler durable design is enough.

### Goal 4 — Preserve honest repo semantics
Do not document future architecture as if it were already implemented.
Keep “implemented”, “in progress”, and “target state” clearly separated.

---

## 3. Skill roadmap for zero/low-cost retrieval

### Skill A — Headless browser operator
Purpose:
- visit search engines and target sites directly
- extract DOM/text
- optionally capture screenshots for model inspection

Recommended stack:
- Playwright first
- Chromium in `headless: true`
- Xvfb only if a specific workflow truly needs a virtual display layer

Why this works on Ubuntu without a GUI:
- Chromium can render DOM and execute JS in memory
- no physical display is required
- screenshots are still possible in headless mode

Proposed tool surface:
- `open_browser(url)`
- `navigate(url)`
- `click(selector)`
- `fill(selector, value)`
- `extract_page_content()`
- `snapshot_page()`
- `close_browser()`

Use cases:
- free web search via DuckDuckGo or public search result pages
- scraping documentation pages after JS execution
- multi-step page flows that RSS alone cannot cover

### Skill B — Local code interpreter / crawler sandbox
Purpose:
- generate short Python programs on demand
- fetch and parse pages with `requests` / `BeautifulSoup`
- transform data locally without depending on bespoke APIs

Recommended execution model:
- isolated container or equivalent sandbox
- ephemeral filesystem
- explicit CPU / memory / timeout limits
- captured stdout / stderr / artifacts

Proposed tool surface:
- `execute_python_code(code, files?, timeout?)`

Security notes:
- treat network access as intentional, not automatic
- apply resource limits
- prefer an allowlist or at least a clear audit trail for outbound fetches

### Skill C — Open-data / RSS aggregator
Purpose:
- build a reliable no-auth information layer for common research tasks

Good initial sources:
- Google News RSS
- Bing RSS web search where still useful
- official site RSS feeds
- Hacker News
- arXiv
- GitHub Trending (HTML parse)
- Wikipedia OpenSearch / summaries

Status note:
- `skills/no-card-search/` is the current seed of this direction
- V2 should treat it as a base capability, not a side utility

### Skill D — Local RAG over user-owned content
Purpose:
- shift more retrieval value toward the user's own docs and notes

Candidate stack:
- ChromaDB plus a lightweight local embedding model
- or a simpler first step using SQLite/FTS if vector search is not immediately needed

Suggested first document classes:
- workspace docs
- private notes explicitly intended for retrieval
- project READMEs and SOPs
- incident reports / postmortems

---

## 4. Gateway durability: from V1 recovery to V2 stateless handling

### Current V1 state
Current repo assets support a **restart-resume PoC**:
- helper scripts prepare resume tasks before restart
- startup hook runs hidden recovery work after restart
- results are mirrored back to the original session

This is useful, but it is still a **recovery overlay**, not a fully durable core runtime.

### V2 target state
The gateway should be able to:
- persist user turns before LLM generation starts
- persist assistant turns immediately when finalized
- rebuild session context from durable storage after process restart
- detect interrupted work and either resume or mark it clearly
- avoid relying on in-memory-only conversation state for correctness

### Important design correction
Do **not** model durability as “rewrite the entire session array into Redis after every turn” unless absolutely necessary.

That pattern is simple, but it has problems:
- larger payload rewrites over time
- race conditions if multiple workers touch the same session
- poor visibility into partial/incomplete turns
- weak auditability compared with append-only records

A better V2 design is:
- append-only message records
- session metadata records
- explicit turn status / lease records
- optional derived-context cache built from durable records

---

## 5. Recommended storage approach

### Option 1 — SQLite in WAL mode (recommended first on a single VM)
Why it is attractive:
- simplest operations burden
- durable on local disk
- no extra service to babysit
- good enough for a single-node gateway if write volume is moderate

Good fit when:
- one Azure VM is the main runtime
- priority is crash recovery and simplicity, not distributed scale

### Option 2 — Redis with AOF enabled
Why it is attractive:
- fast session access
- useful for leases, queues, and ephemeral coordination
- easy TTL handling for derived context caches

Caution:
- default Redis snapshot-only persistence is **not** enough for strong crash guarantees
- if Redis is used as the main store, AOF and restart durability settings must be configured deliberately

Good fit when:
- Redis is needed anyway for coordination and short-lived state
- operators accept the persistence model and tune it correctly

### Option 3 — Postgres later
Good when:
- multi-node scaling
- stronger relational querying
- more complex operational reporting

Not required for the first V2 milestone.

### Practical recommendation
For this environment, the pragmatic sequence is:
1. durable transcript store in SQLite WAL
2. optional Redis later for locks / queues / hot cache
3. postpone heavier distributed architecture until there is a real scaling need

---

## 6. Proposed durable data model

### A. `messages`
One row/event per message.
Fields should include at least:
- `message_id`
- `session_key`
- `turn_id`
- `role` (`user`, `assistant`, `tool`, `system`)
- `content`
- `created_at`
- `provider_message_id` if available
- `delivery metadata` if needed for reply routing

### B. `session_state`
Per-session metadata such as:
- `session_key`
- `last_message_at`
- `last_completed_turn_id`
- `last_known_channel`
- `last_known_peer`
- `summary/cache pointers`

### C. `turns`
Track lifecycle of each user request.
Fields:
- `turn_id`
- `session_key`
- `status` (`received`, `running`, `completed`, `failed`, `interrupted`)
- `lease_owner`
- `lease_expires_at`
- `started_at`
- `completed_at`
- `error`

### D. Optional `resume_tasks`
Keep only for transitional logic.
Over time, `pending-resume.d` should become a fallback mechanism rather than the primary continuity model.

---

## 7. Proposed message lifecycle

### Step 1 — Receive user message
- assign `turn_id`
- persist the incoming user message immediately
- mark turn as `received`

### Step 2 — Claim processing lease
- move turn to `running`
- record `lease_owner` and expiry
- prevent duplicate workers from processing the same turn blindly

### Step 3 — Build context from durable history
- load recent messages from storage
- apply summarization / context-window logic as a derived step
- do not rely on a process-local array as the source of truth

### Step 4 — Run LLM/tools
- perform model call
- run tools as needed
- keep enough state in durable records to understand what was happening if the process dies

### Step 5 — Persist assistant result
- write assistant message durably
- mark turn `completed`
- update session metadata

### Step 6 — Delivery
- send the assistant reply to the channel
- if delivery fails, durable state should still show that generation succeeded and delivery must be retriable

---

## 8. Relationship to the current restart-resume PoC

### What stays useful
The current helper scripts still have value for:
- planned maintenance windows
- best-effort continuity during controlled restarts
- channels where reply metadata must be carried across a bounce

### What changes in V2
Once durable turn storage exists:
- restart-resume becomes a fallback convenience, not the main safety layer
- `pending-resume.d` should no longer be the only recovery path
- gateway startup should not need hidden recovery sessions just to rediscover the last conversation turn

In other words:
- V1 = heuristic continuation layer
- V2 = storage-backed continuity by default

---

## 9. Delivery cadence

### 24-hour sprint target
If the goal is to finish within 24 hours, the scope must be compressed to a believable first cut.

That 24-hour target should include only:
- durable session foundation
- low-cost retrieval baseline (`no-card-search` + normalized source handling)
- a minimal code-interpreter contract
- one real crash-test validation

That 24-hour target should **not** require all of the following to be fully implemented:
- Playwright browser automation
- Local RAG with embeddings
- broader distributed-scale architecture

See the concrete sprint breakdown in:
- `workspace/docs/openclaw-v2-24h-sprint.md`

### Phase 1 — Durable session foundation
Deliver:
- durable message/turn store (SQLite WAL first, or Redis+AOF if intentionally chosen)
- append-only persistence for user/assistant turns
- interrupted-turn detection
- replay/rebuild of session context from storage
- migration note describing how this coexists with current resume hooks

Acceptance target:
- unexpected process death does not erase the last user message
- session continuity survives normal service restart

### Phase 2 — Retrieval stack upgrade
Deliver:
- promote `no-card-search` from fallback to core low-cost retrieval path
- add code interpreter sandbox
- add RSS/open-data aggregator refinements

Acceptance target:
- common search/news/research tasks work without paid search APIs in most cases

### Phase 3 — Browser operator
Deliver:
- Playwright-based browsing/extraction skill
- page interaction helpers
- optional screenshot pipeline where helpful

Acceptance target:
- JS-heavy pages can be queried even without a commercial web search API

### Phase 4 — Local RAG
Deliver:
- document indexing for selected local knowledge sources
- embedding + retrieval pipeline
- clear privacy boundaries around what gets indexed

Acceptance target:
- the assistant can answer more questions from owned/local data with lower external dependency

---

## 10. Chaos test acceptance standard

A V2 durability milestone should not be called done until it survives a deliberate crash test.

### Example test
1. Start OpenClaw normally.
2. Send a multi-part prompt such as:
   - “我叫张三，帮我用 Python 写一个计算斐波那契数列的脚本，并分析一下当前的热点科技新闻。”
3. While code generation / retrieval is in progress, force-kill the gateway process:
   - `kill -9 <pid>`
4. Restart the gateway.
5. Send a follow-up:
   - “我叫什么名字？你刚才的代码写完了吗？”

### Pass criteria
The system should be able to recover enough durable context to:
- remember the stored user fact (“张三”)
- recognize that the previous turn existed
- either continue the interrupted work or respond clearly that the turn was interrupted and is being resumed/retried

### Important nuance
Passing this test does **not** require preserving hidden chain-of-thought or exact in-flight model internals.
It requires preserving the **conversation and turn state needed for user-visible continuity**.

---

## 11. What this backup repo should preserve for V2

As V2 work proceeds, this repo should capture:
- storage schema or migration docs
- sanitized config changes
- new skill folders / helper scripts
- crash-test SOPs and results
- compatibility patches
- architectural decisions and rollback notes

This repo should remain:
- private
- sanitized
- honest about what is implemented versus aspirational

---

## 12. Execution companion

For the implementation breakdown, sequencing, and definition-of-done checklists, see:
- `workspace/docs/openclaw-v2-implementation-checklist.md`

## 13. Short version

The strategic direction is sound:
- reduce paid search/API dependence
- upgrade browser/code/open-data/local-RAG capabilities
- replace restart heuristics with durable session storage

But the implementation path should be pragmatic:
- do not overstate current capability
- prefer append-only durable message records over rewriting giant in-memory arrays
- on one VM, start simple and durable first
- keep `restart-resume` as a fallback until storage-backed continuity is proven

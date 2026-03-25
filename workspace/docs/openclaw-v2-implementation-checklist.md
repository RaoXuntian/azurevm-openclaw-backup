# OpenClaw V2 Implementation Checklist

Purpose: convert the V2 roadmap into concrete workstreams, sequencing, and acceptance checks.

Related docs:
- `workspace/docs/openclaw-v2-roadmap.md`
- `workspace/docs/restart-resume-poc.md`
- `workspace/docs/openclaw-safe-upgrade-sop.md`

---

## 0. Guiding rules

Before implementing anything in V2, keep these rules explicit:

- Do not describe target-state architecture as already shipped.
- Prefer simple, durable building blocks over clever distributed design.
- On a single Azure VM, default to **SQLite WAL first** unless there is a hard reason not to.
- Keep `restart-resume` as a fallback continuity tool until storage-backed continuity passes crash tests.
- Any feature that increases retrieval power must still respect cost and operational stability.
- Any feature that increases execution power (browser/code sandbox) must have limits and auditability.

---

## 1. Workstream A — Durable session foundation

### Objective
Make user-visible session continuity survive process restart and unexpected crashes.

### Recommendation
Implement this first.
Without this, the rest of V2 adds capability but not reliability.

### A1. Decide storage model
Primary recommendation:
- [ ] confirm `SQLite + WAL` as the first durable store

If rejected, document why and choose instead:
- [ ] `Redis + AOF`
- [ ] other

Decision record should answer:
- [ ] why this store fits a single-VM deployment
- [ ] expected write/read pattern
- [ ] durability guarantees under restart / crash
- [ ] backup / restore approach
- [ ] migration path if scale increases later

### A2. Define schema
Minimum durable entities:
- [ ] `messages`
- [ ] `turns`
- [ ] `session_state`
- [ ] optional `deliveries` or delivery-attempt records
- [ ] optional `tool_runs` if tool continuity needs explicit traceability

Schema checklist:
- [ ] unique IDs for messages and turns
- [ ] session key index
- [ ] created/updated timestamps
- [ ] role / message type field
- [ ] turn status lifecycle field
- [ ] channel/delivery metadata where needed
- [ ] interruption / retry markers

### A3. Define write points in the lifecycle
Must be explicit and testable.

- [ ] persist user message immediately on receipt
- [ ] create turn record before model generation begins
- [ ] mark turn `running` only after lease/ownership is established
- [ ] persist assistant reply before considering the turn complete
- [ ] persist failure/interruption state on exceptions/timeouts
- [ ] keep delivery retry separate from generation success

### A4. Context reconstruction logic
- [ ] define how recent message history is loaded from storage
- [ ] define summarization/compaction policy
- [ ] define whether summaries are cached or recomputed
- [ ] ensure in-memory arrays are treated as cache, not source of truth

### A5. Interrupted-turn handling
- [ ] define `received` / `running` / `completed` / `failed` / `interrupted`
- [ ] define lease timeout / stale-run detection
- [ ] define startup scan for interrupted turns
- [ ] define whether interrupted turns auto-resume or just become visible/retriable

### A6. Migration / coexistence with V1 resume flow
- [ ] document how `pending-resume.d` coexists with durable turns during transition
- [ ] define when V1 scripts are still required
- [ ] define the condition for downgrading `restart-resume` from primary to fallback

### A7. Backup and recovery for the durable store
- [ ] file location documented
- [ ] local rollback strategy documented
- [ ] sanitized backup strategy documented
- [ ] corruption/rebuild procedure documented

### Definition of done for Workstream A
- [ ] forced restart does not lose the last user message
- [ ] completed assistant messages persist across restart
- [ ] interrupted turns are detectable after restart
- [ ] context can be rebuilt from storage without relying on previous process memory
- [ ] crash test passes at least once in a documented run

---

## 2. Workstream B — Retrieval stack upgrade

### Objective
Reduce dependence on paid search APIs by making low-cost retrieval first-class.

### B1. Promote `no-card-search` from fallback to core strategy
- [ ] review existing `skills/no-card-search/` scope
- [ ] document supported query types
- [ ] document known weaknesses / freshness limits
- [ ] define when to prefer it over premium search
- [ ] define when to escalate to browser automation

### B2. Standardize source categories
Core source buckets:
- [ ] news RSS
- [ ] web search RSS / public query pages
- [ ] Wikipedia
- [ ] arXiv
- [ ] GitHub Trending / repo discovery
- [ ] official site RSS feeds

For each source, document:
- [ ] input format
- [ ] rate-limit or politeness constraints
- [ ] parsing strategy
- [ ] expected output shape
- [ ] failure mode / fallback

### B3. Normalize retrieval output
- [ ] define a shared result schema across retrieval methods
- [ ] include source URL/title/snippet/time when available
- [ ] include confidence/quality notes where appropriate
- [ ] make summarization layer separate from fetch layer

### B4. Operational safeguards
- [ ] timeout limits
- [ ] max page/source count per request
- [ ] retry policy
- [ ] respect 429 / backoff
- [ ] avoid bursty scraping loops

### Definition of done for Workstream B
- [ ] common news/research/search tasks succeed acceptably without paid search in most cases
- [ ] outputs are structured enough to feed downstream summarization
- [ ] failures degrade gracefully instead of hanging

---

## 3. Workstream C — Local code interpreter / crawler sandbox

### Objective
Allow on-demand structured retrieval and transformation via generated Python code in a controlled environment.

### C1. Sandbox model choice
- [ ] document runtime isolation choice (container/gVisor/other)
- [ ] define filesystem scope
- [ ] define network policy
- [ ] define CPU/memory/time limits

### C2. Execution contract
Tool contract should specify:
- [ ] code input format
- [ ] stdout/stderr capture
- [ ] exit code handling
- [ ] artifact capture (optional files)
- [ ] timeout behavior
- [ ] package availability policy

### C3. Base Python environment
Minimum likely packages:
- [ ] `requests`
- [ ] `beautifulsoup4`
- [ ] `lxml` (optional)
- [ ] `pandas` only if justified

### C4. Safety / abuse boundaries
- [ ] network activity should be auditable
- [ ] local file access should be constrained
- [ ] no silent persistence across runs unless intentional
- [ ] clear logging for failures and killed runs

### C5. Example tasks to validate
- [ ] fetch and parse a news page
- [ ] scrape a simple HTML table
- [ ] extract structured links from a docs page
- [ ] transform raw text into JSON output

### Definition of done for Workstream C
- [ ] short Python retrieval tasks run successfully in isolation
- [ ] resource limits work
- [ ] failed code returns usable diagnostics
- [ ] the tool is useful enough to replace ad-hoc one-off scraping for common tasks

---

## 4. Workstream D — Browser automation operator

### Objective
Handle JS-heavy pages and interaction flows that RSS/static fetch cannot cover.

### D1. Playwright baseline
- [ ] choose Playwright as default implementation
- [ ] pin browser/runtime install steps
- [ ] document headless operation on Ubuntu
- [ ] confirm whether Xvfb is actually needed or not

### D2. Minimal action surface
Initial tool actions:
- [ ] open/navigate URL
- [ ] wait for selector / network idle
- [ ] click element
- [ ] fill input
- [ ] extract text/DOM
- [ ] capture screenshot
- [ ] close browser context

### D3. Deterministic extraction patterns
- [ ] define extraction helpers for search result pages
- [ ] define extraction helpers for article/detail pages
- [ ] prefer DOM/text extraction before screenshot interpretation when possible

### D4. Safeguards
- [ ] page timeout
- [ ] max steps per run
- [ ] browser reuse vs isolation decision
- [ ] domain allow/deny considerations if needed later

### D5. Validation flows
- [ ] search-like flow on a free engine
- [ ] navigate to one result and extract readable content
- [ ] handle JS-rendered docs page
- [ ] capture screenshot only when DOM extraction is insufficient

### Definition of done for Workstream D
- [ ] common JS-heavy pages are usable in headless mode
- [ ] extraction is reliable enough to replace manual browsing for routine tasks
- [ ] the action set is small but stable

---

## 5. Workstream E — Local RAG

### Objective
Shift more retrieval value toward user-owned/local data.

### E1. Define indexing scope
Candidate sources:
- [ ] workspace docs
- [ ] selected project repos
- [ ] postmortems / SOPs
- [ ] explicitly approved personal notes only

### E2. Choose first retrieval mode
Recommended sequence:
- [ ] start with FTS / keyword retrieval if enough
- [ ] add embeddings only when semantic retrieval is clearly needed

### E3. Storage choice
- [ ] document whether to use ChromaDB first or a lighter temporary store
- [ ] define re-index triggers
- [ ] define deletion/update behavior

### E4. Privacy boundaries
- [ ] document what must never be indexed by default
- [ ] document opt-in vs opt-out behavior for sensitive notes

### E5. Evaluation prompts
- [ ] retrieve a relevant SOP from local docs
- [ ] answer a question from indexed project notes
- [ ] verify that excluded private data is not returned accidentally

### Definition of done for Workstream E
- [ ] useful answers can be produced from local knowledge without extra web calls
- [ ] indexing scope is explicit and privacy-safe

---

## 6. Cross-cutting workstream — Observability and ops

### Objective
Make V2 debuggable instead of magical.

### O1. Logging
- [ ] durable-store write failures are visible
- [ ] interrupted-turn detection is logged
- [ ] sandbox/browser failures are logged with enough detail
- [ ] delivery failures are separable from generation failures

### O2. Metrics / health checks
- [ ] count interrupted turns
- [ ] count successful resumes / retries
- [ ] track retrieval path usage (RSS vs browser vs code)
- [ ] track timeout/error rate per capability

### O3. Runbooks
- [ ] crash recovery runbook
- [ ] durable-store inspection runbook
- [ ] browser runtime repair runbook
- [ ] sandbox repair runbook

### O4. Backup discipline
- [ ] update `azurevm-openclaw-backup` after meaningful milestones
- [ ] keep config snapshots redacted
- [ ] preserve schema/docs/scripts, not secrets

---

## 7. Suggested execution order

### 24-hour compressed order
If the project is time-boxed to 24 hours, use this sequence:

1. [ ] Workstream A core only (`messages / turns / session_state`, write points, interrupted-turn handling)
2. [ ] minimum observability needed to debug Workstream A
3. [ ] one real crash test and documentation of results
4. [ ] Workstream B core only (`no-card-search` positioning + normalized low-cost retrieval output)
5. [ ] Workstream C contract only (minimal code-interpreter interface and limits)
6. [ ] explicitly defer most of Workstream D and Workstream E

Why:
- reliability is the only thing that truly deserves day-one priority
- low-cost retrieval is the next biggest business win
- browser automation is valuable but easier to slip without blocking the 24-hour success definition

### Full follow-on order
### Phase 1 — Reliability first
1. [ ] Workstream A (durable session foundation)
2. [ ] Cross-cutting observability for A
3. [ ] crash test and document results

### Phase 2 — Cheapest useful retrieval
4. [ ] Workstream B (RSS/open-data retrieval cleanup)
5. [ ] Workstream C (local code interpreter)

### Phase 3 — Harder retrieval surfaces
6. [ ] Workstream D (browser automation)

### Phase 4 — Owned knowledge advantage
7. [ ] Workstream E (local RAG)

Reasoning:
- reliability should come before new capability
- cheap/static retrieval should come before full browser automation
- local RAG is valuable, but only after the storage/retrieval base is clear

---

## 8. Minimum milestone set

### Milestone M1 — Crash-safe transcript baseline
Ship when all are true:
- [ ] user messages persist immediately
- [ ] assistant final replies persist durably
- [ ] interrupted turns are marked/recoverable
- [ ] restart does not erase session continuity basics

### Milestone M2 — No-cost retrieval baseline
Ship when all are true:
- [ ] `no-card-search` path is documented and stable
- [ ] RSS/open-data results have normalized output
- [ ] the code sandbox can handle simple scraping tasks

### Milestone M3 — Browser retrieval baseline
Ship when all are true:
- [ ] Playwright flow works headlessly on Ubuntu
- [ ] a small stable tool surface is defined
- [ ] JS-heavy pages can be extracted reliably

### Milestone M4 — Local knowledge baseline
Ship when all are true:
- [ ] chosen local data scope is indexed
- [ ] retrieval quality is good enough to be useful
- [ ] privacy boundaries are documented and respected

---

## 9. Explicit non-goals for the first V2 cut

Do **not** let the first V2 milestone balloon into all of these at once:

- [ ] multi-node distributed architecture
- [ ] fully general desktop automation
- [ ] broad package-install freedom inside the sandbox
- [ ] perfect in-flight task replay semantics
- [ ] a giant universal RAG index over everything on disk

The first V2 cut should prove:
- durable conversation continuity
- cheaper retrieval paths
- controlled execution capability

That is enough.

---

## 10. Chaos testing checklist

### Test A — hard kill during generation
- [ ] start a multi-step request
- [ ] kill the gateway with `kill -9`
- [ ] restart service
- [ ] verify last user fact survives
- [ ] verify interrupted turn is visible/recoverable

### Test B — hard kill during retrieval
- [ ] trigger browser/code/RSS work
- [ ] kill process mid-run
- [ ] restart service
- [ ] verify no silent transcript loss

### Test C — delivery failure after successful generation
- [ ] simulate delivery failure
- [ ] verify generation result remains durably recorded
- [ ] verify delivery can be retried separately

### Test D — repeated restart
- [ ] restart twice in short succession
- [ ] verify no duplicate completion or confused turn state

Document every run with:
- [ ] date/time
- [ ] code version / commit
- [ ] scenario
- [ ] pass/fail
- [ ] observed gaps
- [ ] follow-up actions

---

## 11. Repo updates expected as work lands

As implementation progresses, this backup repo should be updated with:
- [ ] schema docs / migration notes
- [ ] sanitized config deltas
- [ ] new skill/tool docs
- [ ] runbooks / SOPs
- [ ] crash-test notes
- [ ] rollback notes

If a change is important enough that losing it would hurt, it should be committed here or in the relevant project repo.

---

## 12. Short execution summary

If execution starts tomorrow, the recommended first three concrete moves are:

1. [ ] write the durable storage decision note (`SQLite WAL first` unless disproven)
2. [ ] define `messages / turns / session_state` schema and write points
3. [ ] run one real crash-test after the first persistence implementation

Everything else gets easier once those three are real.

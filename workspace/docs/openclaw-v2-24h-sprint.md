# OpenClaw V2 24-Hour Sprint Plan

Purpose: define what “done in 24 hours” actually means without pretending the entire long-term V2 vision can ship in one day.

---

## 1. Delivery principle

A 24-hour finish only works if scope is compressed aggressively.

So for this sprint:
- **ship the reliability core first**
- **ship one low-cost retrieval path that is already close to real**
- **defer heavier capabilities that would create schedule risk**

This means the 24-hour target is:
- a **V2 foundation release**, not the complete end-state V2 vision

---

## 2. What counts as done in 24 hours

### Must ship within 24 hours

#### A. Durable session continuity baseline
This is the real priority.

Required outcome:
- user messages are durably recorded immediately
- assistant final replies are durably recorded
- interrupted turns can be detected after restart
- a forced restart does not erase the last meaningful conversation state

Recommended implementation boundary:
- SQLite in WAL mode
- `messages`
- `turns`
- `session_state`
- one documented crash test

#### B. Low-cost retrieval baseline
Required outcome:
- `no-card-search` is elevated from fallback to official low-cost retrieval path
- source behavior is documented clearly
- result shape is normalized enough to be reused

#### C. One small execution capability
Required outcome:
- choose **either**:
  - minimal code sandbox contract
  - minimal browser operator contract

For the 24-hour sprint, the better choice is:
- **minimal code sandbox contract first**

Reason:
- lower setup risk than full Playwright hardening
- faster path to useful structured retrieval

---

## 3. Explicitly deferred beyond 24 hours

These are important, but should **not** block the sprint completion:

- full Playwright browser-automation implementation
- screenshot-heavy visual workflows
- Local RAG with embeddings / ChromaDB
- multi-node or distributed durability design
- generalized task replay for every in-flight tool call
- production-grade full observability polish

If these are partially documented but not implemented, that is acceptable for the sprint.

---

## 4. Recommended 24-hour scope cut

### Ship in sprint
- durable session store design and first implementation path
- schema + lifecycle write points
- interrupted-turn handling design
- one crash-test runbook and one executed validation
- `no-card-search` positioning/documentation cleanup
- minimal code-interpreter contract doc
- updated README / roadmap / checklist to reflect the compressed scope honestly

### Defer after sprint
- Playwright implementation details
- browser interaction helper library
- local RAG indexing
- advanced metrics/runbooks beyond the essentials

---

## 5. 24-hour schedule

### Hour 0–2 — Scope lock and architecture decision
- freeze sprint scope
- confirm SQLite WAL as first durable store
- freeze the minimum schema
- define pass/fail acceptance for the sprint

### Hour 2–6 — Durable storage design
- define `messages / turns / session_state`
- define write points in the message lifecycle
- define interrupted-turn state transitions
- document delivery-vs-generation separation

### Hour 6–12 — First implementation pass
- wire durable writes for incoming user turns
- wire durable writes for final assistant turns
- add startup/interruption detection path
- keep V1 restart-resume as fallback only

### Hour 12–15 — Retrieval baseline cleanup
- formalize `no-card-search` as the low-cost default path where applicable
- normalize source/result structure in docs and/or interfaces
- document escalation rules

### Hour 15–18 — Minimal execution capability
- define minimal code sandbox contract
- specify limits, expected packages, and failure output
- do not overbuild sandbox orchestration in this sprint

### Hour 18–21 — Chaos testing
- run hard-kill crash test
- verify transcript durability
- verify interrupted-turn visibility
- record pass/fail and remaining gaps

### Hour 21–24 — Cleanup and ship
- update backup repo docs
- record known limitations
- commit milestone cleanly
- leave deferred items clearly listed instead of half-pretending they shipped

---

## 6. Sprint acceptance criteria

The sprint can be called complete only if all are true:

- [ ] last user message survives forced restart
- [ ] final assistant reply is durably recoverable after restart
- [ ] interrupted turn is visible or resumable in a defined way
- [ ] `restart-resume` is clearly documented as fallback, not primary architecture
- [ ] low-cost retrieval path is documented as the operational default where appropriate
- [ ] deferred items are explicitly listed
- [ ] one clean milestone commit exists

---

## 7. Sprint deliverables

By the end of 24 hours, the repo should contain at minimum:

- durable storage decision note
- schema/lifecycle documentation
- 24-hour sprint plan
- updated roadmap/checklist
- crash-test record template or result note
- milestone commit

If code changes land too, even better — but the sprint definition should remain honest about what is implemented versus only designed.

---

## 8. Recommended priority order

If time gets tight, cut in this order:

### Do not cut
1. durable session continuity baseline
2. crash test
3. clear documentation of what is and is not shipped

### Cut next if needed
4. browser operator work
5. Local RAG work
6. advanced metrics polish

### Keep only as design if schedule slips
7. sandbox sophistication beyond the basic contract
8. distributed-scale considerations

---

## 9. Short version

To finish in 24 hours, V2 must mean:
- **durable session continuity first**
- **cheap retrieval second**
- **one minimal execution path third**
- everything else explicitly deferred

That is a believable plan.

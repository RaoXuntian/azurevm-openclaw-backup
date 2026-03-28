/**
 * OpenClaw V2 — Graceful Shutdown Preload
 *
 * Injected into the gateway process via NODE_OPTIONS="--import <path>"
 * This code runs INSIDE the gateway's Node.js process, sharing the same
 * globalThis — which means we can directly access the Lane Queue state
 * used by markGatewayDraining() / waitForActiveTasks() / etc.
 *
 * The preload installs SIGTERM/SIGINT handlers that execute the shutdown
 * pipeline BEFORE the gateway's own handlers (or the OS default) run.
 *
 * Usage:
 *   NODE_OPTIONS="--import /path/to/graceful-shutdown-preload.mjs" openclaw gateway
 *
 * Or via the wrapper script:
 *   ./graceful-gateway.sh [openclaw gateway args]
 *
 * Environment:
 *   GRACE_PERIOD_MS     Soft drain timeout in ms (default: 30000)
 *   HARD_KILL_MS        Hard kill delta after soft drain (default: 10000)
 *   GRACEFUL_LOG        Set to "0" to suppress log output
 *
 * This file does NOT modify anything under node_modules/openclaw/.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ─── Configuration ──────────────────────────────────────────────────────────

const GRACE_PERIOD_MS = parseInt(process.env.GRACE_PERIOD_MS || '30000', 10);
const HARD_KILL_MS    = parseInt(process.env.HARD_KILL_MS    || '10000', 10);
const SILENT          = process.env.GRACEFUL_LOG === '0';

const P = '🦞 [graceful]';
const log  = SILENT ? () => {} : (msg) => console.log(`${P} ${msg}`);
const warn = SILENT ? () => {} : (msg) => console.warn(`${P} ⚠️  ${msg}`);
const err  = (msg) => console.error(`${P} ❌ ${msg}`);

// ─── Lazy internal symbol resolution ────────────────────────────────────────
//
// We can't resolve symbols at preload time because pi-embedded hasn't been
// imported yet by the gateway. Instead, we defer resolution to when SIGTERM
// actually fires. By that point the gateway is fully running and all modules
// are loaded into the module cache.
//
// Strategy A: Read the Lane Queue state directly from globalThis (preferred)
// Strategy B: Dynamic import of pi-embedded and resolve export aliases (fallback)

const COMMAND_QUEUE_STATE_KEY = Symbol.for('openclaw.commandQueueState');

function getQueueState() {
  return globalThis[COMMAND_QUEUE_STATE_KEY] ?? null;
}

/**
 * Mark the gateway as draining. New tasks enqueued via enqueueCommandInLane()
 * will be rejected with GatewayDrainingError.
 */
function markDraining() {
  const state = getQueueState();
  if (state) {
    state.gatewayDraining = true;
    return true;
  }
  return false;
}

/**
 * Count currently executing tasks across all lanes.
 */
function getActiveCount() {
  const state = getQueueState();
  if (!state) return 0;
  let total = 0;
  for (const lane of state.lanes.values()) {
    total += lane.activeTaskIds.size;
  }
  return total;
}

/**
 * Wait for all currently active tasks to finish or timeout.
 * Only tracks tasks that are already executing — new enqueues after
 * markDraining() are rejected, so the set is monotonically shrinking.
 */
function waitForActiveTasks(timeoutMs) {
  const POLL_MS = 100;
  const deadline = Date.now() + timeoutMs;
  const state = getQueueState();

  if (!state) return Promise.resolve({ drained: true, reason: 'no-queue-state' });

  // Snapshot task IDs that are currently active
  const activeAtStart = new Set();
  for (const lane of state.lanes.values()) {
    for (const taskId of lane.activeTaskIds) {
      activeAtStart.add(taskId);
    }
  }

  if (activeAtStart.size === 0) {
    return Promise.resolve({ drained: true, reason: 'no-active-tasks' });
  }

  return new Promise((resolve) => {
    const check = () => {
      // Check if any of the originally-active tasks are still running
      let hasPending = false;
      for (const lane of state.lanes.values()) {
        for (const taskId of lane.activeTaskIds) {
          if (activeAtStart.has(taskId)) {
            hasPending = true;
            break;
          }
        }
        if (hasPending) break;
      }

      if (!hasPending) {
        resolve({ drained: true, reason: 'all-completed' });
        return;
      }

      if (Date.now() >= deadline) {
        resolve({ drained: false, reason: 'timeout', remaining: getActiveCount() });
        return;
      }

      setTimeout(check, POLL_MS);
    };
    check();
  });
}

// ─── Graceful shutdown pipeline ─────────────────────────────────────────────

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  const startTime = Date.now();
  log(`Received ${signal} — initiating graceful shutdown pipeline...`);
  log(`Config: GRACE_PERIOD_MS=${GRACE_PERIOD_MS}, HARD_KILL_MS=${HARD_KILL_MS}`);

  // ── Step 1: Mark draining ────────────────────────────────────────────
  log('Step 1/3: Marking gateway as draining...');
  const marked = markDraining();
  if (marked) {
    log(`  Queue state found ✓ — new LLM tasks will be rejected`);
  } else {
    warn('  Queue state not found on globalThis — gateway may not have fully started');
    warn('  Proceeding to exit after brief delay...');
    await new Promise(r => setTimeout(r, 2000));
    process.exit(0);
    return;
  }

  const activeCount = getActiveCount();
  log(`  Active in-flight tasks: ${activeCount}`);

  // ── Step 2: Drain in-flight tasks ────────────────────────────────────
  if (activeCount > 0) {
    log(`Step 2/3: Waiting for ${activeCount} task(s) to complete (timeout: ${GRACE_PERIOD_MS}ms)...`);

    const result = await waitForActiveTasks(GRACE_PERIOD_MS);

    if (result.drained) {
      const elapsed = Date.now() - startTime;
      log(`  All tasks drained in ${elapsed}ms ✓`);
    } else {
      const remaining = getActiveCount();
      warn(`  Soft drain timeout — ${remaining} task(s) still active`);

      // Hard kill phase: brief additional wait then give up
      if (HARD_KILL_MS > 0 && remaining > 0) {
        log(`  Hard kill phase: waiting additional ${HARD_KILL_MS}ms...`);
        const hardResult = await waitForActiveTasks(HARD_KILL_MS);
        if (hardResult.drained) {
          log(`  Hard kill phase: tasks completed ✓`);
        } else {
          warn(`  Hard kill: ${getActiveCount()} task(s) abandoned`);
        }
      }
    }
  } else {
    log('Step 2/3: No active tasks — skipping drain');
  }

  // ── Step 3: Exit ─────────────────────────────────────────────────────
  //
  // We don't call runGlobalGatewayStopSafely() here because the gateway's
  // own shutdown sequence will handle resource teardown when it receives
  // the process exit. Our job is just the drain.
  //
  // By calling process.exit(0), Node.js will:
  //   1. Run all 'exit' event handlers (gateway's cleanup)
  //   2. Close the event loop
  //   3. Return exit code 0 to the process manager
  //
  const totalMs = Date.now() - startTime;
  log(`Step 3/3: Shutdown complete in ${totalMs}ms — exiting with code 0`);
  log('Goodbye! 🦞');

  process.exit(0);
}

// ─── Signal handler installation ────────────────────────────────────────────
//
// Install our handlers early. Node.js signal handlers run in registration
// order, but process.on('SIGTERM') overrides the default signal behavior
// (which would kill the process). Our handler runs the drain pipeline,
// then calls process.exit(0).
//
// We use { once: false } so we can handle repeated signals (e.g., double
// Ctrl+C just logs that shutdown is already in progress).

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

log('Preload active — SIGTERM/SIGINT handlers installed');
log(`Drain budget: ${GRACE_PERIOD_MS}ms soft + ${HARD_KILL_MS}ms hard = ${GRACE_PERIOD_MS + HARD_KILL_MS}ms total`);

/**
 * OpenClaw V2 — Graceful Shutdown Preload
 *
 * Injected into the gateway process via NODE_OPTIONS="--import <path>"
 *
 * OpenClaw core only drains in-flight tasks on SIGUSR1 (restart), NOT on
 * SIGTERM (stop). On SIGTERM, it closes the server and exits immediately,
 * potentially killing in-flight LLM requests.
 *
 * This preload intercepts all SIGTERM/SIGINT handler registrations via a
 * process.on() proxy, captures the core's handlers, and runs a drain-first
 * pipeline before handing control back to the core's shutdown sequence.
 *
 * Usage:
 *   NODE_OPTIONS="--import /path/to/graceful-shutdown-preload.mjs" openclaw gateway
 *
 * Environment:
 *   GRACE_PERIOD_MS     Soft drain timeout in ms (default: 30000)
 *   HARD_KILL_MS        Hard kill delta after soft drain (default: 10000)
 *   GRACEFUL_LOG        Set to "0" to suppress log output
 */

// ─── Configuration ──────────────────────────────────────────────────────────

const GRACE_PERIOD_MS = parseInt(process.env.GRACE_PERIOD_MS || '30000', 10);
const HARD_KILL_MS    = parseInt(process.env.HARD_KILL_MS    || '10000', 10);
const SILENT          = process.env.GRACEFUL_LOG === '0';

const P = '🦞 [graceful]';
const log  = SILENT ? () => {} : (msg) => console.log(`${P} ${msg}`);
const warn = SILENT ? () => {} : (msg) => console.warn(`${P} ⚠️  ${msg}`);

// ─── Lane Queue access via globalThis singleton ─────────────────────────────

const COMMAND_QUEUE_STATE_KEY = Symbol.for('openclaw.commandQueueState');

function getQueueState() {
  return globalThis[COMMAND_QUEUE_STATE_KEY] ?? null;
}

function markDraining() {
  const state = getQueueState();
  if (state) {
    state.gatewayDraining = true;
    return true;
  }
  return false;
}

function getActiveCount() {
  const state = getQueueState();
  if (!state) return 0;
  let total = 0;
  for (const lane of state.lanes.values()) {
    total += lane.activeTaskIds.size;
  }
  return total;
}

function waitForActiveTasks(timeoutMs) {
  const POLL_MS = 100;
  const deadline = Date.now() + timeoutMs;
  const state = getQueueState();

  if (!state) return Promise.resolve({ drained: true });

  const activeAtStart = new Set();
  for (const lane of state.lanes.values()) {
    for (const taskId of lane.activeTaskIds) {
      activeAtStart.add(taskId);
    }
  }

  if (activeAtStart.size === 0) {
    return Promise.resolve({ drained: true });
  }

  return new Promise((resolve) => {
    const check = () => {
      let hasPending = false;
      for (const lane of state.lanes.values()) {
        for (const taskId of lane.activeTaskIds) {
          if (activeAtStart.has(taskId)) { hasPending = true; break; }
        }
        if (hasPending) break;
      }

      if (!hasPending) { resolve({ drained: true }); return; }
      if (Date.now() >= deadline) { resolve({ drained: false }); return; }
      setTimeout(check, POLL_MS);
    };
    check();
  });
}

// ─── Intercept process.on() to capture core signal handlers ─────────────────
//
// This is the most reliable approach: we monkey-patch process.on/once so that
// when the core gateway registers its SIGTERM/SIGINT handlers, we silently
// capture them instead of letting them register. When our drain finishes,
// we call the captured handlers directly.

const INTERCEPTED_SIGNALS = new Set(['SIGTERM', 'SIGINT']);
const capturedCoreHandlers = { SIGTERM: [], SIGINT: [] };
let ourHandlersInstalled = false;

const origProcessOn   = process.on.bind(process);
const origProcessOnce = process.once.bind(process);

process.on = function patchedOn(event, listener) {
  if (INTERCEPTED_SIGNALS.has(event) && ourHandlersInstalled) {
    // This is the core (or any other code) trying to register a signal handler.
    // Capture it instead of registering.
    capturedCoreHandlers[event].push(listener);
    log(`  Intercepted core ${event} handler registration`);
    return this;
  }
  return origProcessOn(event, listener);
};

process.once = function patchedOnce(event, listener) {
  if (INTERCEPTED_SIGNALS.has(event) && ourHandlersInstalled) {
    capturedCoreHandlers[event].push(listener);
    log(`  Intercepted core ${event} handler registration (once)`);
    return this;
  }
  return origProcessOnce(event, listener);
};

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
    log('  Queue state found ✓ — new LLM tasks will be rejected');
  } else {
    warn('  Queue state not found — falling back to core shutdown');
    invokeCoreThenExit(signal);
    return;
  }

  const activeCount = getActiveCount();
  log(`  Active in-flight tasks: ${activeCount}`);

  // ── Step 2: Drain in-flight tasks ────────────────────────────────────
  if (activeCount > 0) {
    log(`Step 2/3: Waiting for ${activeCount} task(s) to complete (timeout: ${GRACE_PERIOD_MS}ms)...`);

    const result = await waitForActiveTasks(GRACE_PERIOD_MS);

    if (result.drained) {
      log(`  All tasks drained in ${Date.now() - startTime}ms ✓`);
    } else {
      const remaining = getActiveCount();
      warn(`  Soft drain timeout — ${remaining} task(s) still active`);

      if (HARD_KILL_MS > 0 && remaining > 0) {
        log(`  Hard kill phase: waiting additional ${HARD_KILL_MS}ms...`);
        const hardResult = await waitForActiveTasks(HARD_KILL_MS);
        if (hardResult.drained) {
          log('  Hard kill phase: tasks completed ✓');
        } else {
          warn(`  Hard kill: ${getActiveCount()} task(s) abandoned`);
        }
      }
    }
  } else {
    log('Step 2/3: No active tasks — skipping drain');
  }

  // ── Step 3: Hand off to core shutdown ────────────────────────────────
  const totalMs = Date.now() - startTime;
  log(`Step 3/3: Drain complete in ${totalMs}ms — invoking core shutdown...`);

  invokeCoreThenExit(signal);
}

/**
 * Call captured core signal handlers, then exit if they don't.
 */
function invokeCoreThenExit(signal) {
  const handlers = capturedCoreHandlers[signal] || [];

  if (handlers.length > 0) {
    log(`  Invoking ${handlers.length} captured core ${signal} handler(s)...`);
    for (const handler of handlers) {
      try { handler(); } catch (e) { warn(`  Core handler error: ${e.message}`); }
    }
    // Core should eventually call process.exit(). Safety net:
    setTimeout(() => {
      warn('  Core did not exit within 15s — forcing exit');
      process.exit(0);
    }, 15000).unref();
  } else {
    log('  No captured core handlers — exiting directly');
    process.exit(0);
  }
}

// ─── Install our signal handlers ────────────────────────────────────────────
// Use the ORIGINAL process.on so our handlers are real, not intercepted.

origProcessOn('SIGTERM', () => gracefulShutdown('SIGTERM'));
origProcessOn('SIGINT',  () => gracefulShutdown('SIGINT'));
ourHandlersInstalled = true;

log('Preload active — SIGTERM/SIGINT handlers installed');
log(`Drain budget: ${GRACE_PERIOD_MS}ms soft + ${HARD_KILL_MS}ms hard = ${GRACE_PERIOD_MS + HARD_KILL_MS}ms total`);

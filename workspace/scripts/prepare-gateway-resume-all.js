#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const out = {
    reason: '',
    dryRun: false,
    maxAgeHours: 24,
    maxCandidates: 12,
    includeSessionKeys: [],
    ignoreExistingPending: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reason') out.reason = argv[++i] ?? '';
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--max-age-hours') out.maxAgeHours = Number(argv[++i] ?? out.maxAgeHours);
    else if (arg === '--max-candidates') out.maxCandidates = Number(argv[++i] ?? out.maxCandidates);
    else if (arg === '--include-session-key') out.includeSessionKeys.push(String(argv[++i] ?? '').trim());
    else if (arg === '--ignore-existing-pending') out.ignoreExistingPending = true;
    else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!Number.isFinite(out.maxAgeHours) || out.maxAgeHours <= 0) throw new Error('--max-age-hours must be > 0');
  if (!Number.isFinite(out.maxCandidates) || out.maxCandidates <= 0) throw new Error('--max-candidates must be > 0');
  out.includeSessionKeys = out.includeSessionKeys.filter(Boolean);
  return out;
}

function normalizeText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function parseAgentId(sessionKey) {
  const m = /^agent:([^:]+):/i.exec(String(sessionKey || '').trim());
  return m?.[1]?.trim() || 'main';
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function firstTextSnippet(value, limit = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function extractVisibleText(message) {
  const parts = Array.isArray(message?.content) ? message.content : [];
  const texts = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && normalizeText(part.text)) texts.push(part.text.trim());
  }
  return texts.join('\n').trim();
}

function summarizeUserPrompt(message) {
  const visible = extractVisibleText(message);
  return firstTextSnippet(visible || message?.content?.[0]?.text || '');
}

function classifyTranscriptRows(rows) {
  const messages = [];
  for (const row of rows) {
    if (row?.type !== 'message' || !row.message) continue;
    const role = String(row.message.role || '').trim();
    if (!role) continue;
    const visibleText = extractVisibleText(row.message);
    messages.push({
      role,
      timestamp: row.timestamp || null,
      hasVisibleText: Boolean(visibleText),
      visibleText,
      raw: row.message,
    });
  }
  return messages;
}

function findResumeSignal(messages, entry) {
  const lastUserIndex = [...messages].map((m, i) => [m, i]).reverse().find(([m]) => m.role === 'user')?.[1] ?? -1;
  if (lastUserIndex < 0) {
    return { shouldResume: false, reason: 'no-user-message' };
  }

  const afterLastUser = messages.slice(lastUserIndex + 1);
  const assistantTextAfter = afterLastUser.some((m) => m.role === 'assistant' && m.hasVisibleText);
  if (assistantTextAfter) {
    return { shouldResume: false, reason: 'latest-user-already-has-assistant-text' };
  }

  const lastRelevant = [...messages].reverse().find((m) => ['user', 'assistant', 'toolResult'].includes(m.role));
  if (!lastRelevant) {
    return { shouldResume: false, reason: 'no-relevant-tail-message' };
  }

  const signal = {
    shouldResume: false,
    reason: 'not-detected',
    latestUserSummary: summarizeUserPrompt(messages[lastUserIndex]?.raw),
    confidence: 0,
  };

  if (entry?.abortedLastRun) {
    signal.shouldResume = true;
    signal.reason = 'aborted-last-run';
    signal.confidence = 1.0;
  }

  if (lastRelevant.role === 'user') {
    signal.shouldResume = true;
    signal.reason = 'tail-is-user';
    signal.confidence = Math.max(signal.confidence, 0.98);
  } else if (lastRelevant.role === 'toolResult') {
    signal.shouldResume = true;
    signal.reason = 'tail-is-toolResult-without-assistant-text';
    signal.confidence = Math.max(signal.confidence, 0.93);
  } else if (lastRelevant.role === 'assistant' && !lastRelevant.hasVisibleText) {
    signal.shouldResume = true;
    signal.reason = 'tail-is-assistant-thinking-without-visible-text';
    signal.confidence = Math.max(signal.confidence, 0.88);
  }

  return signal;
}

function isHiddenOrInternalSession(sessionKey) {
  return /:resume:|:subagent:/i.test(sessionKey) || /^agent:[^:]+:cron(?::|$)/i.test(sessionKey);
}

function isUserFacingSession(entry) {
  const origin = entry?.origin || {};
  const delivery = entry?.deliveryContext || {};
  return Boolean(
    normalizeText(origin.provider)
    || normalizeText(delivery.channel)
    || normalizeText(origin.chatType)
  );
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function listAgentSessionStores(stateRoot) {
  const agentsRoot = path.join(stateRoot, 'agents');
  const entries = await readdir(agentsRoot, { withFileTypes: true }).catch(() => []);
  const stores = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storePath = path.join(agentsRoot, entry.name, 'sessions', 'sessions.json');
    if (await exists(storePath)) stores.push({ agentId: entry.name, storePath });
  }
  return stores.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

async function listExistingPendingSessions(pendingDir, legacyPath) {
  const existing = new Set();
  if (await exists(legacyPath)) {
    try {
      const legacy = await readJson(legacyPath);
      if (legacy?.active === true && legacy?.status === 'pending' && normalizeText(legacy?.sessionKey)) {
        existing.add(legacy.sessionKey.trim());
      }
    } catch {}
  }
  const entries = await readdir(pendingDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const data = await readJson(path.join(pendingDir, entry.name));
      if (data?.active === true && data?.status === 'pending' && normalizeText(data?.sessionKey)) {
        existing.add(data.sessionKey.trim());
      }
    } catch {}
  }
  return existing;
}

function buildReply(entry) {
  const origin = entry?.origin || {};
  const delivery = entry?.deliveryContext || {};
  const channel = String(delivery.channel || origin.provider || '').trim();
  const to = String(delivery.to || origin.to || '').trim();
  const accountId = String(delivery.accountId || origin.accountId || '').trim();
  if (channel === 'openclaw-weixin' && to && accountId) {
    return { channel: 'openclaw-weixin', to, accountId };
  }
  return undefined;
}

function buildPayload({ sessionKey, entry, signal, reason }) {
  const origin = entry?.origin || {};
  const delivery = entry?.deliveryContext || {};
  const reply = buildReply(entry);
  const id = `auto-resume-${hashText(`${sessionKey}:${Date.now()}:${Math.random()}`)}-${Date.now()}`;
  const notes = [
    'This task was auto-created immediately before a deliberate gateway restart.',
    'Read recent session history to recover context, but continue only the latest unfinished user request for this session.',
    'If the latest user request was already fully answered before restart, mark the task completed and explain that no additional reply was needed.',
    'Set lastResult to the exact user-facing reply text you want delivered back to the original session.',
    `Detection heuristic: ${signal.reason}.`,
    `Latest user summary: ${signal.latestUserSummary || '(not captured)'}`,
  ];
  if (reason) notes.push(`Restart reason: ${reason}`);
  if (reply) notes.push('Because this is a direct Weixin chat, the startup hook can deliver lastResult back through reply.channel/accountId/to.');
  else notes.push('If direct delivery is unavailable, the startup hook will mirror lastResult back into the original session transcript.');

  return {
    id,
    active: true,
    status: 'pending',
    resumeAfterGatewayRestart: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    agentId: parseAgentId(sessionKey),
    sessionKey,
    task: 'Resume the interrupted conversation after gateway restart and continue the latest unfinished user request in this session.',
    steps: [
      'Read recent session history for this session.',
      'Infer the latest unfinished user-facing task from the immediate pre-restart context.',
      'Continue that task in a hidden recovery session.',
      'Write the final user-facing reply into lastResult and mark the task completed.',
    ],
    notes,
    detection: {
      heuristic: signal.reason,
      confidence: signal.confidence,
      latestUserSummary: signal.latestUserSummary || null,
      sessionUpdatedAt: entry?.updatedAt || null,
      abortedLastRun: Boolean(entry?.abortedLastRun),
    },
    originSnapshot: {
      provider: origin.provider || null,
      label: origin.label || null,
      chatType: origin.chatType || entry?.chatType || null,
      from: origin.from || null,
      to: origin.to || null,
      accountId: origin.accountId || null,
      surface: origin.surface || null,
    },
    deliverySnapshot: {
      channel: delivery.channel || null,
      to: delivery.to || null,
      accountId: delivery.accountId || null,
    },
    ...(reply ? { reply } : {}),
  };
}

async function readTranscriptMessages(sessionFile) {
  const raw = await readFile(sessionFile, 'utf8');
  const rows = raw.split(/\r?\n/).map(parseJsonLine).filter(Boolean);
  return classifyTranscriptRows(rows);
}

async function scanSessionStore({ agentId, storePath }, opts, existingPending) {
  const store = await readJson(storePath);
  const now = Date.now();
  const maxAgeMs = opts.maxAgeHours * 60 * 60 * 1000;
  const includeSet = new Set(opts.includeSessionKeys);
  const candidates = [];
  const skipped = [];

  for (const [sessionKey, entry] of Object.entries(store)) {
    const updatedAt = Number(entry?.updatedAt || 0);
    const forced = includeSet.has(sessionKey);

    if (isHiddenOrInternalSession(sessionKey)) {
      skipped.push({ sessionKey, reason: 'internal-session' });
      continue;
    }
    if (!forced && updatedAt > 0 && now - updatedAt > maxAgeMs) {
      skipped.push({ sessionKey, reason: 'too-old' });
      continue;
    }
    if (!forced && !isUserFacingSession(entry)) {
      skipped.push({ sessionKey, reason: 'not-user-facing' });
      continue;
    }
    if (!forced && !opts.ignoreExistingPending && existingPending.has(sessionKey)) {
      skipped.push({ sessionKey, reason: 'pending-task-already-exists' });
      continue;
    }

    const sessionFile = normalizeText(entry?.sessionFile)
      || path.join(path.dirname(storePath), `${entry?.sessionId || ''}.jsonl`);
    if (!sessionFile || !await exists(sessionFile)) {
      skipped.push({ sessionKey, reason: 'missing-transcript' });
      continue;
    }

    let messages;
    try {
      messages = await readTranscriptMessages(sessionFile);
    } catch (err) {
      skipped.push({ sessionKey, reason: `transcript-read-failed:${String(err)}` });
      continue;
    }

    const signal = findResumeSignal(messages, entry);
    if (!signal.shouldResume && !forced) {
      skipped.push({ sessionKey, reason: signal.reason });
      continue;
    }

    const payload = buildPayload({ sessionKey, entry, signal, reason: opts.reason.trim() });
    candidates.push({
      sessionKey,
      agentId,
      updatedAt,
      signal,
      payload,
      fileName: `${payload.id}.json`,
    });
  }

  candidates.sort((a, b) => {
    const conf = (b.signal.confidence || 0) - (a.signal.confidence || 0);
    if (conf !== 0) return conf;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return {
    agentId,
    storePath,
    candidates: candidates.slice(0, opts.maxCandidates),
    skipped,
    totalScanned: Object.keys(store).length,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const stateRoot = path.join(os.homedir(), '.openclaw');
  const workspaceDir = path.join(stateRoot, 'workspace');
  const pendingDir = path.join(workspaceDir, 'runtime', 'pending-resume.d');
  const pendingLegacyPath = path.join(workspaceDir, 'runtime', 'pending-resume.json');
  await mkdir(pendingDir, { recursive: true });

  const existingPending = await listExistingPendingSessions(pendingDir, pendingLegacyPath);
  const stores = await listAgentSessionStores(stateRoot);
  const results = [];
  for (const store of stores) {
    results.push(await scanSessionStore(store, opts, existingPending));
  }

  const allCandidates = results.flatMap((r) => r.candidates)
    .sort((a, b) => ((b.signal.confidence || 0) - (a.signal.confidence || 0)) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
    .slice(0, opts.maxCandidates);

  const written = [];
  if (!opts.dryRun) {
    for (const candidate of allCandidates) {
      const filePath = path.join(pendingDir, candidate.fileName);
      await writeFile(filePath, JSON.stringify(candidate.payload, null, 2) + '\n', 'utf8');
      written.push({ sessionKey: candidate.sessionKey, filePath, heuristic: candidate.signal.reason });
    }
  }

  const summary = {
    ok: true,
    mode: opts.dryRun ? 'dry-run' : 'write',
    scannedAgents: results.length,
    scannedSessions: results.reduce((sum, item) => sum + item.totalScanned, 0),
    existingPendingSessions: existingPending.size,
    selectedCount: allCandidates.length,
    heuristics: {
      includeSignals: [
        'tail-is-user',
        'tail-is-toolResult-without-assistant-text',
        'tail-is-assistant-thinking-without-visible-text',
        'aborted-last-run',
      ],
      skipSignals: [
        'latest-user-already-has-assistant-text',
        'too-old',
        'internal-session',
        'not-user-facing',
        'pending-task-already-exists',
        'missing-transcript',
      ],
      recencyWindowHours: opts.maxAgeHours,
      maxCandidates: opts.maxCandidates,
      ignoreExistingPending: opts.ignoreExistingPending,
    },
    candidates: allCandidates.map((candidate) => ({
      sessionKey: candidate.sessionKey,
      updatedAt: candidate.updatedAt,
      heuristic: candidate.signal.reason,
      confidence: candidate.signal.confidence,
      latestUserSummary: candidate.signal.latestUserSummary || null,
      filePath: path.join(pendingDir, candidate.fileName),
      reply: candidate.payload.reply || null,
    })),
    written,
    stores: results.map((r) => ({
      agentId: r.agentId,
      storePath: r.storePath,
      totalScanned: r.totalScanned,
      selected: r.candidates.length,
      skippedPreview: r.skipped.slice(0, 20),
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});

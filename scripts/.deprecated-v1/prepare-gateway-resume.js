#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const out = {
    sessionKey: '',
    task: '',
    reason: '',
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--session-key') out.sessionKey = argv[++i] ?? '';
    else if (arg === '--task') out.task = argv[++i] ?? '';
    else if (arg === '--reason') out.reason = argv[++i] ?? '';
    else if (arg === '--dry-run') out.dryRun = true;
    else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!out.sessionKey.trim()) throw new Error('--session-key is required');
  return out;
}

function parseAgentId(sessionKey) {
  const m = /^agent:([^:]+):/i.exec(sessionKey.trim());
  return m?.[1]?.trim() || 'main';
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv);
  const sessionKey = args.sessionKey.trim();
  const agentId = parseAgentId(sessionKey);
  const stateRoot = path.join(os.homedir(), '.openclaw');
  const workspaceDir = path.join(stateRoot, 'workspace');
  const pendingDir = path.join(workspaceDir, 'runtime', 'pending-resume.d');
  const sessionsStorePath = path.join(stateRoot, 'agents', agentId, 'sessions', 'sessions.json');
  const store = await readJson(sessionsStorePath);
  const entry = store?.[sessionKey];
  if (!entry?.sessionId) {
    throw new Error(`Session not found in store: ${sessionKey}`);
  }

  const origin = entry.origin || {};
  const delivery = entry.deliveryContext || {};
  const channel = String(delivery.channel || origin.provider || '').trim();
  const to = String(delivery.to || origin.to || '').trim();
  const accountId = String(delivery.accountId || origin.accountId || '').trim();

  const reply = channel === 'openclaw-weixin' && to && accountId
    ? {
        channel: 'openclaw-weixin',
        to,
        accountId,
      }
    : undefined;

  const id = `auto-resume-${hashText(sessionKey)}-${Date.now()}`;
  const task = args.task.trim() || 'Resume the interrupted conversation after gateway restart and continue the latest unfinished user request in this session.';
  const notes = [
    'This task was auto-created immediately before a deliberate gateway restart.',
    'Read recent session history to recover context, but continue only the latest unfinished user request for this session.',
    'If the latest user request was already fully answered before restart, mark the task completed and explain that no additional reply was needed.',
    'Set lastResult to the exact user-facing reply text you want delivered back to the original session.',
  ];
  if (args.reason.trim()) notes.push(`Restart reason: ${args.reason.trim()}`);
  if (reply) notes.push('Because this is a direct Weixin chat, the startup hook can deliver lastResult back through reply.channel/accountId/to.');
  else notes.push('If direct delivery is unavailable, the startup hook will mirror lastResult back into the original session transcript.');

  const payload = {
    id,
    active: true,
    status: 'pending',
    resumeAfterGatewayRestart: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    agentId,
    sessionKey,
    task,
    steps: [
      'Read recent session history for this session.',
      'Infer the latest unfinished user-facing task from the immediate pre-restart context.',
      'Continue that task in a hidden recovery session.',
      'Write the final user-facing reply into lastResult and mark the task completed.',
    ],
    notes,
    originSnapshot: {
      provider: origin.provider || null,
      label: origin.label || null,
      chatType: origin.chatType || null,
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

  const filePath = path.join(pendingDir, `${id}.json`);
  if (args.dryRun) {
    console.log(JSON.stringify({ filePath, payload }, null, 2));
    return;
  }
  await mkdir(pendingDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ ok: true, filePath, sessionKey, reply: reply || null }, null, 2));
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});
